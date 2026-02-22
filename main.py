"""
Tab Harvester — FastAPI Backend
================================
POST /api/summarize
  • Accepts JSON with url, title, content
  • Uses Vertex AI (Gemini Pro) to generate a 2-sentence summary + 3 tags
  • Inserts the result into Supabase `archived_tabs`
  • Increments counters in Supabase `system_metrics`
  • Returns 200 OK
"""

import json
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import vertexai
from vertexai.generative_models import GenerativeModel, Part
from supabase import create_client, Client

# ── Load environment variables ──────────────────────────────────────────────
load_dotenv()

GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT")
GOOGLE_CLOUD_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not GOOGLE_CLOUD_PROJECT:
    raise RuntimeError("GOOGLE_CLOUD_PROJECT env var is required")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_KEY env vars are required")

# ── Initialize Vertex AI ────────────────────────────────────────────────────
vertexai.init(project=GOOGLE_CLOUD_PROJECT, location=GOOGLE_CLOUD_LOCATION)

SYSTEM_PROMPT = (
    "You are an AI research assistant. Read the following webpage text and "
    "return a JSON object with two keys: summary (a 2-sentence summary of "
    "the page) and tags (an array of 3 categorical strings)."
)

model = GenerativeModel(
    model_name="gemini-pro",
    system_instruction=SYSTEM_PROMPT,
)

# ── Initialize Supabase ─────────────────────────────────────────────────────
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── FastAPI app ──────────────────────────────────────────────────────────────
app = FastAPI(title="Tab Harvester API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SummarizeRequest(BaseModel):
    url: str
    title: str
    content: str


class SummarizeResponse(BaseModel):
    status: str
    summary: str
    tags: list[str]


# ── POST /api/summarize ─────────────────────────────────────────────────────
@app.post("/api/summarize", response_model=SummarizeResponse)
async def summarize_tab(payload: SummarizeRequest):
    """
    1. Summarize the page content with Gemini Pro
    2. Insert into archived_tabs
    3. Increment system_metrics
    """

    # ── Step 1: Generate summary via Vertex AI (Gemini Pro) ──────────────
    user_prompt = (
        f"Title: {payload.title}\n"
        f"URL: {payload.url}\n\n"
        f"Page content:\n{payload.content[:30000]}"  # cap to avoid token overflow
    )

    try:
        response = model.generate_content(user_prompt)
        raw_text = response.text.strip()

        # The model should return JSON, but sometimes wraps it in markdown fences
        if raw_text.startswith("```"):
            # Strip ```json ... ``` wrapper
            raw_text = raw_text.split("\n", 1)[1]  # remove first line
            raw_text = raw_text.rsplit("```", 1)[0].strip()

        result = json.loads(raw_text)
        summary = result.get("summary", "")
        tags = result.get("tags", [])

        if not summary or not isinstance(tags, list):
            raise ValueError("Model returned unexpected structure")

    except json.JSONDecodeError:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini returned non-JSON response: {raw_text[:200]}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Vertex AI error: {str(e)}",
        )

    # ── Step 2: Insert into archived_tabs ────────────────────────────────
    try:
        supabase.table("archived_tabs").insert({
            "url": payload.url,
            "title": payload.title,
            "summary": summary,
            "tags": tags,
            "archived_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Supabase insert error: {str(e)}",
        )

    # ── Step 3: Increment system_metrics ─────────────────────────────────
    try:
        # Use Supabase RPC to atomically increment counters.
        # Assumes an RPC function `increment_metrics` exists, OR we
        # fall back to a read-then-update approach.
        metrics = (
            supabase.table("system_metrics")
            .select("*")
            .limit(1)
            .single()
            .execute()
        )
        current = metrics.data

        supabase.table("system_metrics").update({
            "total_tabs_closed": current["total_tabs_closed"] + 1,
            "total_ram_saved_mb": current["total_ram_saved_mb"] + 400,
            "total_power_saved_watts": round(
                current["total_power_saved_watts"] + 0.18, 2
            ),
        }).eq("id", current["id"]).execute()

    except Exception as e:
        # Non-fatal — log but still return success since the tab was archived
        print(f"⚠️  Metrics update failed: {e}")

    # ── Done ─────────────────────────────────────────────────────────────
    print(f"✅ Archived: {payload.title} ({payload.url})")
    return SummarizeResponse(status="ok", summary=summary, tags=tags)


# ── Health check ─────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "healthy"}
