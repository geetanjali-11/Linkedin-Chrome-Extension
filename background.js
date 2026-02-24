// Import Sheets helper
importScripts("sheets.js");

let automationState = {
  isRunning: false,
  sessionInviteCount: 0,
  batchCount: 0,
  totalRows: 0,
  currentRowIndex: 0,
  settings: {},
  activeTabId: null,
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startAutomation") {
    startAutomation(request.settings);
  } else if (request.action === "stopAutomation") {
    stopAutomation();
  }
});

async function startAutomation(settings) {
  automationState.isRunning = true;
  automationState.settings = settings;
  automationState.batchCount = 0;
  automationState.sessionInviteCount = 0;

  logToPopup("Fetching Google Sheet data...", "info");

  try {
    const rows = await SheetsAPI.fetchRows(settings.sheetId);
    automationState.totalRows = rows.length - 1; // Exclude header
    logToPopup(`Found ${rows.length} rows. Starting loop...`, "info");

    // Main Loop
    for (let i = 1; i < rows.length; i++) {
      if (!automationState.isRunning) break;

      const row = rows[i];
      const name = row[0];
      const profileUrl = row[1];
      const note = row[2];
      const status = row[3];

      automationState.currentRowIndex = i;
      updateProgress(i, rows.length - 1);

      // Skip if already processed
      if (status === "Yes" || status === "Skipped") {
        continue;
      }

      // Check Session Safety Cap
      if (automationState.sessionInviteCount >= settings.inviteCap) {
        logToPopup("Session invite cap reached. Stopping.", "warning");
        break;
      }

      // Check Batch Cooldown
      if (automationState.batchCount >= settings.batchSize) {
        await runCooldown(settings.cooldownTime);
        automationState.batchCount = 0;
      }

      logToPopup(`Processing row ${i}: ${name}`, "info");

      try {
        const result = await processProfile(profileUrl, note, i);
        if (result.status === "Yes") {
          automationState.sessionInviteCount++;
          automationState.batchCount++;
        }
        // Include reason in the sheet when available (truncate to keep cell tidy)
        const statusText =
          result.status === "Yes"
            ? "Yes"
            : result.reason
              ? `Failed: ${String(result.reason).slice(0, 140)}`
              : result.status;
        await SheetsAPI.updateRow(settings.sheetId, i, statusText);
        logToPopup(
          `Row ${i} result: ${statusText}`,
          result.status === "Yes" ? "success" : "info",
        );
      } catch (err) {
        const reason = err && err.message ? err.message : String(err);
        logToPopup(`Row ${i} error: ${reason}`, "error");
        try {
          await SheetsAPI.updateRow(
            settings.sheetId,
            i,
            `Failed: ${String(reason).slice(0, 140)}`,
          );
        } catch (uErr) {
          logToPopup(
            `Failed to write error status to sheet: ${uErr.message}`,
            "error",
          );
        }
      }

      // Random delay between profiles
      const randomDelay = 5000 + Math.random() * 10000; // 5-15s
      await new Promise((resolve) => setTimeout(resolve, randomDelay));
    }

    logToPopup("Automation cycle completed.", "info");
  } catch (err) {
    logToPopup(`Critical Error: ${err.message}`, "error");
  } finally {
    stopAutomation();
  }
}

// Execute the automation function directly in the page via scripting.executeScript
// This is a fallback when chrome.tabs.sendMessage cannot reach the content script
async function executeInPage(tabId, message, timeoutMs = 60000) {
  // Ensure content.js is injected first
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (e) {
    // Try to resolve an alternative tab and rethrow if none
    if (e && e.message && e.message.toLowerCase().includes("no tab with id")) {
      const resolved = await findTabByUrlForActiveSession();
      if (resolved && resolved.id) tabId = resolved.id;
      else throw e;
    } else {
      throw e;
    }
  }

  // If message.action is 'ping', respond quickly
  if (message.action === "ping") return { alive: true };

  if (message.action === "executeConnect") {
    // Call LI.run(note) in the page and return its result
    const callResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (note) => {
        try {
          if (typeof globalThis.LI !== "undefined" && globalThis.LI && typeof globalThis.LI.run === "function") {
            const res = await globalThis.LI.run(note);
            return res;
          }
          return { status: "Failed", reason: "LI.run not available" };
        } catch (err) {
          return {
            status: "Failed",
            reason: err && err.message ? err.message : String(err),
          };
        }
      },
      args: [message.note],
    });

    // executeScript returns an array of results (one per frame). Prefer the first result's returnValue
    if (
      callResult &&
      callResult.length &&
      callResult[0] &&
      callResult[0].result
    ) {
      return callResult[0].result;
    }
    throw new Error("executeInPage: no result returned");
  }

  throw new Error("executeInPage: unsupported action");
}

async function processProfile(url, note, rowIndex) {
  // 1. Lock Row
  await SheetsAPI.lockRow(automationState.settings.sheetId, rowIndex);

  // 2. Manage Tab — try to reuse existing tab, otherwise create one. Ensure tabId is valid.
  let tab = null;
  try {
    if (automationState.activeTabId) {
      tab = await chrome.tabs.update(automationState.activeTabId, {
        url,
        active: true,
      });
    } else {
      tab = await chrome.tabs.create({ url, active: true });
    }
  } catch (e) {
    try {
      tab = await chrome.tabs.create({ url, active: true });
    } catch (e2) {
      throw new Error("Failed to open profile tab");
    }
  }

  let tabId = tab && tab.id ? tab.id : null;
  if (!tabId) {
    const resolved = await findTabByUrlForActiveSession();
    if (resolved && resolved.id) tabId = resolved.id;
  }

  if (!tabId) throw new Error("Failed to obtain a valid tab id for profile");
  automationState.activeTabId = tabId;
  logToPopup(`Using tab id ${tabId} for profile`, "info");

  // 3. Wait for tab to finish loading
  await waitForTabComplete(tabId);

  // 4. Extra SPA buffer — LinkedIn React needs time to render
  await new Promise((r) => setTimeout(r, 8000));

  // 5. Ensure content script is alive (ping → inject if not)
  await ensureContentScript(tabId);

  // 6. Send automation command securely via execution scripting to circumvent message channel closure events
  return executeInPage(tabId, { action: "executeConnect", note }, 90000);
}

// ── Ping the content script; inject it if not responding ─────────────────────
async function ensureContentScript(tabId, retries = 4) {
  await new Promise(r => setTimeout(r, 1000));
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await sendMessage(tabId, { action: "ping" }, 3000);
      if (resp && resp.alive) {
        console.log("[BG] Content script is alive.");
        return;
      }
    } catch (err) {
      console.warn(
        `[BG] ping failed (attempt ${i + 1}/${retries}): ${err.message}`,
      );
    }

    console.log(
      `[BG] Content script not responding (attempt ${i + 1}/${retries}). Injecting...`,
    );
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
    } catch (injectErr) {
      console.warn(
        "[BG] Injection error:",
        injectErr && injectErr.message ? injectErr.message : injectErr,
      );
      // If the injection failed due to invalid tab, try to resolve an alternative LinkedIn tab
      if (
        injectErr &&
        injectErr.message &&
        (injectErr.message.toLowerCase().includes("no tab with id") ||
          injectErr.message
            .toLowerCase()
            .includes("could not establish connection"))
      ) {
        try {
          const resolved = await findTabByUrlForActiveSession();
          if (resolved && resolved.id) {
            tabId = resolved.id;
            automationState.activeTabId = tabId;
            console.log("[BG] Resolved tab id to", tabId);
          }
        } catch (resolveErr) {
          console.warn(
            "[BG] Could not resolve alternative tab:",
            resolveErr.message || resolveErr,
          );
        }
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    "Content script did not respond after multiple injection attempts.",
  );
}

// Try to find an open LinkedIn tab to inject into when the original tab id is invalid
async function findTabByUrlForActiveSession() {
  try {
    if (automationState.activeTabId) {
      try {
        const t = await chrome.tabs.get(automationState.activeTabId);
        if (t && t.id) return t;
      } catch (_) {
        // tab not found, continue to query
      }
    }

    const tabs = await chrome.tabs.query({ url: "*://*.linkedin.com/*" });
    if (tabs && tabs.length) {
      const active = tabs.find((t) => t.active) || tabs[0];
      return active;
    }
    return null;
  } catch (err) {
    console.warn(
      "[BG] findTabByUrlForActiveSession error:",
      err && err.message ? err.message : err,
    );
    return null;
  }
}

// ── Promise wrapper for chrome.tabs.sendMessage ───────────────────────────────
function sendMessage(tabId, message, timeoutMs = 60000) {
  const maxRetries = 2;
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const trySend = () => {
      attempts++;
      const timer = setTimeout(() => {
        reject(
          new Error(`sendMessage timeout (${timeoutMs}ms): ${message.action}`),
        );
      }, timeoutMs);

      chrome.tabs.sendMessage(tabId, message, (result) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          const errMsg =
            chrome.runtime.lastError.message ||
            "Unknown chrome.runtime.lastError";
          logToPopup(`sendMessage error: ${errMsg}`, "warning");

          // If the port closed early, try injecting content script and retry
          if (
            errMsg.toLowerCase().includes("message port closed") &&
            attempts <= maxRetries
          ) {
            console.warn(
              "[BG] Message port closed — attempting to inject content script and retry",
            );
            chrome.scripting
              .executeScript({ target: { tabId }, files: ["content.js"] })
              .catch(() => {});
            // small delay before retrying
            setTimeout(trySend, 1200);
            return;
          }

          // If the receiving end does not exist, try a more robust executeScript fallback
          if (
            (errMsg.toLowerCase().includes("receiving end does not exist") ||
              errMsg
                .toLowerCase()
                .includes("could not establish connection"))
          ) {
            if (message.action === "ping") {
              // During a ping, it's normal for the receiving end not to exist yet if the script isn't injected.
              // We just silently reject so the ping loop can inject it, without logging a massive error.
              reject(new Error(errMsg));
              return;
            }

            if (attempts <= maxRetries) {
               console.warn(
                "[BG] sendMessage fallback — attempting executeScript runner",
               );
               executeInPage(tabId, message, timeoutMs)
                .then(resolve)
                .catch((exeErr) =>
                  reject(
                    new Error(
                      exeErr && exeErr.message ? exeErr.message : String(exeErr),
                    ),
                  ),
                );
               return;
             }
          }

          reject(new Error(errMsg));
        } else {
          resolve(result);
        }
      });
    };

    trySend();
  });
}

function stopAutomation() {
  automationState.isRunning = false;
  chrome.storage.local.set({ isAutomationRunning: false });
  chrome.runtime.sendMessage({ action: "automationFinished" }).catch(() => {});
  if (automationState.activeTabId) {
    chrome.tabs.remove(automationState.activeTabId).catch(() => {});
    automationState.activeTabId = null;
  }
}

async function runCooldown(minutes) {
  logToPopup(`Batch complete. Cooling down for ${minutes} minutes...`, "info");
  let remaining = minutes * 60;
  while (remaining > 0 && automationState.isRunning) {
    chrome.runtime.sendMessage({ action: "cooldownUpdate", remaining }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1000));
    remaining--;
  }
  chrome.runtime.sendMessage({ action: "cooldownUpdate", remaining: 0 }).catch(() => {});
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function logToPopup(text, logType = "info") {
  chrome.runtime.sendMessage({ action: "log", text, logType }).catch(() => {});
  console.log(`[${logType.toUpperCase()}] ${text}`);
}

function updateProgress(current, total) {
  chrome.runtime.sendMessage({ action: "updateProgress", current, total }).catch(() => {});
}
