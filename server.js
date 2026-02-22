const http = require("http");

const PORT = 8000;

const server = http.createServer((req, res) => {
    // CORS headers so the extension's fetch succeeds
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
    }

    if (req.method === "POST" && req.url === "/api/summarize") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            try {
                const data = JSON.parse(body);
                const preview = (data.bodyText || "").slice(0, 200).replace(/\n/g, " ");

                console.log("──────────────────────────────────────");
                console.log(`📄 Tab ${data.tabId}: ${data.title}`);
                console.log(`🔗 ${data.url}`);
                console.log(`📝 ${preview}${data.bodyText?.length > 200 ? "..." : ""}`);
                console.log(`   (${(data.bodyText || "").length} chars total)`);
                console.log("──────────────────────────────────────\n");

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "ok", message: "Tab harvested successfully" }));
            } catch (err) {
                console.error("❌ Bad request:", err.message);
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
        });
    } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
    }
});

server.listen(PORT, () => {
    console.log(`\n🌾 Tab Harvester API server running at http://localhost:${PORT}`);
    console.log(`   Endpoint: POST http://localhost:${PORT}/api/summarize\n`);
});
