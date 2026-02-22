/**
 * Tab Harvester - Background Service Worker
 *
 * Listens for the system idle state. When the user goes idle,
 * it harvests content from inactive, non-audible tabs, sends
 * the data to a local summarization API, and closes tabs that
 * were successfully processed.
 */

const API_ENDPOINT = "http://localhost:8000/api/summarize";
const IDLE_DETECTION_INTERVAL_SECONDS = 30;

// Set the idle detection interval for testing
chrome.idle.setDetectionInterval(IDLE_DETECTION_INTERVAL_SECONDS);

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
      // Skip chrome:// internal pages, extensions, etc. — they block scripting
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
        // Extract page content via scripting API
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            title: document.title,
            url: window.location.href,
            bodyText: document.body.innerText,
          }),
        });

        const pageData = result?.result;
        if (!pageData) {
          console.warn(
            `[Tab Harvester] No data extracted from tab ${tab.id} (${tab.url})`
          );
          continue;
        }

        console.log(
          `[Tab Harvester] Extracted data from: "${pageData.title}" — sending to API...`
        );

        // POST the extracted data to the summarization API
        const response = await fetch(API_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: pageData.url,
            title: pageData.title,
            content: pageData.bodyText,
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
console.log(
  `[Tab Harvester] Service worker loaded. Idle detection interval: ${IDLE_DETECTION_INTERVAL_SECONDS}s`
);
