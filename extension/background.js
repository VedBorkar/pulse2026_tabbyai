/**
 * Tab Harvester - Background Service Worker
 *
 * Listens for the system idle state. When the user goes idle,
 * it harvests content from inactive, non-audible tabs, sends
 * the data to a local summarization API, and closes tabs that
 * were successfully processed.
 */

const API_ENDPOINT = "http://localhost:8000/api/summarize";
const DEFAULT_IDLE_SECONDS = 100;

// Load idle interval from storage and apply it
async function applyIdleInterval() {
  const result = await chrome.storage.local.get("idleSeconds");
  const seconds = result.idleSeconds || DEFAULT_IDLE_SECONDS;
  chrome.idle.setDetectionInterval(seconds);
  console.log(`[Tab Harvester] Idle detection interval set to ${seconds}s`);
}

// Apply on startup
applyIdleInterval();

// Re-apply whenever the user changes the setting from the popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.idleSeconds) {
    const newVal = changes.idleSeconds.newValue || DEFAULT_IDLE_SECONDS;
    chrome.idle.setDetectionInterval(newVal);
    console.log(`[Tab Harvester] Idle interval updated to ${newVal}s`);
  }
});

/**
 * Listen for idle state changes.
 * Only act when the state transitions to "idle".
 */
chrome.idle.onStateChanged.addListener(async (newState) => {
  if (newState !== "idle") return;

  console.log("[Tab Harvester] User is idle. Starting tab harvest...");

  try {
    // Query all open tabs across all windows
    const allTabs = await chrome.tabs.query({});

    // Identify the active tab in each window so we can skip them
    const activeTabs = await chrome.tabs.query({ active: true });
    const activeTabIds = new Set(activeTabs.map((t) => t.id));

    // Filter to tabs that are NOT active and NOT playing audio
    const candidateTabs = allTabs.filter(
      (tab) => !activeTabIds.has(tab.id) && !tab.audible
    );

    if (candidateTabs.length === 0) {
      console.log("[Tab Harvester] No candidate tabs to harvest.");
      return;
    }

    console.log(
      `[Tab Harvester] Found ${candidateTabs.length} candidate tab(s).`
    );

    for (const tab of candidateTabs) {
      // Skip chrome:// internal pages, extensions, etc.
      if (
        !tab.url ||
        tab.url.startsWith("chrome://") ||
        tab.url.startsWith("chrome-extension://") ||
        tab.url.startsWith("about:") ||
        tab.url.startsWith("edge://") ||
        tab.url.startsWith("brave://")
      ) {
        console.log(
          `[Tab Harvester] Skipping restricted tab: ${tab.url ?? "(no url)"}`
        );
        continue;
      }

      try {
        console.log(
          `[Tab Harvester] Processing: "${tab.title}" — sending to API...`
        );

        // Use tab metadata from chrome.tabs API (no scripting needed)
        const response = await fetch(API_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: tab.url,
            title: tab.title || "Untitled",
            content: tab.title || "",
          }),
        });

        if (response.ok) {
          console.log(
            `[Tab Harvester] API accepted tab ${tab.id}. Closing tab...`
          );
          await chrome.tabs.remove(tab.id);
        } else {
          console.warn(
            `[Tab Harvester] API returned status ${response.status} for tab ${tab.id}. Tab kept open.`
          );
        }
      } catch (err) {
        console.error(
          `[Tab Harvester] Error processing tab ${tab.id} (${tab.url}):`,
          err.message
        );
      }
    }

    console.log("[Tab Harvester] Harvest cycle complete.");
  } catch (err) {
    console.error("[Tab Harvester] Fatal error during harvest:", err.message);
  }
});

// Log when the service worker starts
console.log("[Tab Harvester] Service worker loaded.");
