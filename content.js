// ============================================================
// LinkedIn Sheets Connector — content.js
// ============================================================

if (!globalThis.LI_INITIALIZED) {
  globalThis.LI_INITIALIZED = true;

  globalThis.LI = {
    // ── Structured logger ─────────────────────────────────────
    log(msg, level = "INFO") {
      console.log(`[LinkedIn-Ext][${level}] ${msg}`);
    },

  // ── Simple delay with jitter ───────────────────────────────
  delay(ms) {
    const jitter = Math.floor(Math.random() * ms * 0.2);
    return new Promise((r) => setTimeout(r, ms + jitter));
  },

  // ── Find a visible button by matching its aria-label or
  //    visible text against a list of keyword strings. ────────
  findVisibleButton(keywords, root = document) {
    const buttons = root.querySelectorAll("button");
    for (const btn of buttons) {
      if (btn.offsetParent === null) continue; // hidden
      if (btn.disabled) continue; // disabled
      const label = (btn.getAttribute("aria-label") || "").toLowerCase();
      const text = (btn.innerText || "").trim().toLowerCase();
      for (const kw of keywords) {
        const k = kw.toLowerCase();
        if (label.includes(k) || text === k || text.startsWith(k)) {
          this.log(
            `Found button matching "${kw}": aria="${label}" text="${text}"`,
          );
          return btn;
        }
      }
    }
    return null;
  },

  // ── Find a visible anchor / dropdown item by text ──────────
  findVisibleItem(keywords, root = document) {
    const items = root.querySelectorAll(
      'li, div[role="option"], div[role="menuitem"], a',
    );
    for (const el of items) {
      if (el.offsetParent === null) continue;
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      const text = (el.innerText || "").trim().toLowerCase();
      for (const kw of keywords) {
        const k = kw.toLowerCase();
        if (label.includes(k) || text === k || text.startsWith(k)) {
          this.log(`Found item matching "${kw}": text="${text}"`);
          return el;
        }
      }
    }
    return null;
  },

  // ── Poll for an element using a finder function ────────────
  async waitFor(finderFn, timeoutMs = 6000, interval = 400) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const el = finderFn();
      if (el) return el;
      await this.delay(interval);
    }
    return null;
  },

  // ── Wait for profile section to appear (SPA guard) ────────
  async waitForProfile(timeoutMs = 40000) {
    this.log("Waiting for LinkedIn profile to load...");
    // ANY of these selectors appearing means the profile rendered enough to proceed.
    const profileSelectors = [
      "h1", // person name heading — most reliable
      ".pv-top-card",
      ".pvs-profile-actions",
      ".ph5",
      ".scaffold-layout__main",
      ".artdeco-card",
      "section.artdeco-card",
      ".profile-detail",
      '[data-testid="profile-topcard"]',
      "main",
      "[data-section]",
    ];
    const el = await this.waitFor(
      () =>
        profileSelectors.reduce(
          (found, sel) => found || document.querySelector(sel),
          null,
        ),
      timeoutMs,
    );
    if (el) {
      this.log("Profile section detected.");
      return true;
    }
    // Last-resort: on a /in/ URL with any body content, just proceed.
    if (
      window.location.href.includes("/in/") &&
      document.body.innerText.length > 200
    ) {
      this.log("Profile URL detected with body content — proceeding.");
      return true;
    }

    // Also accept if primary action buttons are present (Connect/Message)
    try {
      const act = Array.from(document.querySelectorAll("button, a")).find(
        (el) => {
          const t = (el.innerText || "").toLowerCase();
          return (
            t.includes("connect") ||
            t.includes("message") ||
            t.includes("follow")
          );
        },
      );
      if (act) {
        this.log("Detected action button — treating profile as loaded.");
        return true;
      }
    } catch (e) {
      /* ignore DOM errors */
    }
    this.log("Profile section NOT detected within timeout.", "WARN");
    return false;
  },

  // ── Human-like typing ──────────────────────────────────────
  async typeInto(el, text) {
    this.log("Typing note...");
    el.focus();
    
    // React 16+ value setter bypass
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    ).set;

    // Clear reactively
    nativeSetter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await this.delay(200);

    let currentText = "";
    for (const ch of text) {
      currentText += ch;
      nativeSetter.call(el, currentText);
      el.dispatchEvent(
        new InputEvent("input", {
          inputType: "insertText",
          data: ch,
          bubbles: true,
        }),
      );
      await this.delay(25 + Math.random() * 75);
    }
    await this.delay(300);
  },

  // ── MutationObserver-based confirmation watcher ────────────
  waitForInvitationSent(timeoutMs = 9000) {
    return new Promise((resolve) => {
      const check = () => {
        const body = document.body.innerText || "";
        if (
          body.includes("Invitation sent") ||
          body.includes("invitation sent")
        ) {
          return true;
        }
        // Also look at toast containers and modals
        const toasts = document.querySelectorAll(
          ".artdeco-toast-item, .ip-fuse-limit-alert, [data-test-artdeco-toast-item]",
        );
        for (const t of toasts) {
          if ((t.innerText || "").toLowerCase().includes("invitation sent"))
            return true;
        }
        return false;
      };

      if (check()) {
        this.log("Confirmation already visible!");
        return resolve(true);
      }

      const observer = new MutationObserver(() => {
        if (check()) {
          this.log("Confirmation detected via MutationObserver!");
          observer.disconnect();
          clearTimeout(timer);
          resolve(true);
        }
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        this.log("Confirmation NOT detected within timeout.", "WARN");
        resolve(false);
      }, timeoutMs);
    });
  },

  // ── Smooth, human-like scroll ──────────────────────────────
  async smoothScroll() {
    const target = Math.min(500, document.body.scrollHeight / 3);
    for (let y = 0; y < target; y += 30) {
      window.scrollTo(0, y);
      await this.delay(18);
    }
    await this.delay(600);
    for (let y = target; y > 0; y -= 40) {
      window.scrollTo(0, y);
      await this.delay(15);
    }
    window.scrollTo(0, 0);
    await this.delay(400);
  },

  // ── Main automation entry point ────────────────────────────
  async run(note) {
    this.log("=== Automation started ===");

    // 1. Guard: Must be on a LinkedIn profile page
    if (!window.location.href.includes("linkedin.com/in/")) {
      return { status: "Failed", reason: "Not a LinkedIn profile page" };
    }

    // 2. Wait for profile to render (SPA protection)
    const loaded = await this.waitForProfile(40000);
    if (!loaded)
      return { status: "Failed", reason: "Profile did not load in time" };

    // Give React extra time to render action buttons after name appears
    await this.delay(2500);
    await this.smoothScroll();
    await this.delay(800);

    // 3. Pre-check: already connected / pending?
    const skipBtn = this.findVisibleButton(["pending", "withdraw", "message"]);
    if (skipBtn) {
      const txt = (skipBtn.innerText || "").toLowerCase();
      if (txt.includes("pending") || txt.includes("withdraw")) {
        this.log("Already pending — skipping.");
        return { status: "Skipped", reason: "Already Pending" };
      }
      if (txt.includes("message")) {
        this.log("Already connected — skipping.");
        return { status: "Skipped", reason: "Already Connected" };
      }
    }

    // 4. STEP 1 — Find primary Connect / Add button
    this.log("STEP 1: Looking for primary Connect/Add button...");
    let connectBtn = this.findVisibleButton(["connect", "add"]);

    // 5. STEP 2 — Fall back to "More" menu
    if (!connectBtn) {
      this.log('STEP 2: Primary not found — trying "More" menu...');
      const moreBtn = this.findVisibleButton(["more actions", "more"]);
      if (moreBtn) {
        moreBtn.click();
        this.log('Clicked "More" menu, waiting for dropdown...');

        // Wait for dropdown items
        const dropItem = await this.waitFor(
          () => this.findVisibleItem(["connect", "add"]),
          4000,
        );
        if (dropItem) {
          this.log("Found Connect/Add in dropdown");
          connectBtn = dropItem;
        }
      }
    }

    // 6. STEP 3 — Give up
    if (!connectBtn) {
      this.log("No connect/add option found.", "WARN");
      return { status: "Skipped", reason: "No connect option found" };
    }

    // 7. Click the connect / add button
    this.log("Clicking Connect/Add...");
    connectBtn.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
    let sent = false;

    // Wait immediately for the modal with "Add a note" / "Send without a note"
    const modalBtn = await this.waitFor(
      () => this.findVisibleButton(["add a note", "add note", "send without a note", "send now"]),
      4000,
    );

    if (modalBtn) {
       this.log("Modal detected. Deciding flow...");
       // 8. Handle Notes & Sending
       if (note && note.trim().length > 0) {
         this.log("A note is present. Clicking Add a note...");
         const addNoteBtn = this.findVisibleButton(["add a note", "add note"]);

         if (addNoteBtn) {
           addNoteBtn.click();
           await this.delay(1500);

           const textarea = await this.waitFor(
             () => document.querySelector('textarea[name="message"], textarea.connect-button-send-invite__custom-message, textarea#custom-message'),
             3000,
           );

           if (textarea) {
             await this.typeInto(textarea, note || "");
             await this.delay(700);
           } else {
             this.log("Textarea not found after clicking Add Note", "WARN");
           }
         } else {
           this.log('No "Add a note" button — proceeding to send.');
         }
       } else {
         this.log("No note provided. Checking for Send without a note...");
         const sendWithoutNoteBtn = this.findVisibleButton(["send without a note"]);

         if (sendWithoutNoteBtn) {
           this.log('Clicking "Send without a note"...');
           sendWithoutNoteBtn.click();
           sent = true;
           await this.delay(1000);
         }
       }
    } else {
      this.log("No invitation modal detected after clicking Connect. Trying to proceed natively.", "WARN");
    }

    // 9. Click Send
    if (!sent) {
      const sendBtn = await this.waitFor(
        () => {
          const textMatch = this.findVisibleButton(["send now", "send invitation", "done", "send", "submit"]);
          if (textMatch) return textMatch;

          // Fallback to primary modal action buttons
          const primaryBtns = document.querySelectorAll(
            ".artdeco-button--primary.ml1, .artdeco-modal__actionbar .artdeco-button--primary, button[aria-label='Send invitation'], .msg-form__send-button"
          );
          for (const pb of primaryBtns) {
            if (!pb.disabled && pb.offsetParent !== null) return pb;
          }
          return null;
        },
        4000,
      );

      if (!sendBtn) {
        this.log("Send button not found.", "WARN");
        return { status: "Failed", reason: "Send button not found" };
      }

      this.log("Clicking Send...");
      sendBtn.click();
    }

    // 10. Wait for confirmation
    const confirmed = await this.waitForInvitationSent();
    if (confirmed) {
      this.log("Invitation confirmed ✔");
      return { status: "Yes" };
    }

    // 11. Fallback: check if button changed to "Pending"
    await this.delay(1500);
    const pendingCheck = this.findVisibleButton(["pending", "withdraw"]);
    if (pendingCheck) {
      this.log("Button changed to Pending — invitation sent ✔");
      return { status: "Yes" };
    }

    this.log("Could not confirm invitation was sent.", "WARN");
    return { status: "Failed", reason: "Invitation confirmation not detected" };
  },
};

// ── Message listener ─────────────────────────────────────────────────────────
// IMPORTANT: return true IMMEDIATELY to keep the message channel open for the
// async response.  Do NOT use async/await on the listener itself.
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "executeConnect") {
    globalThis.LI.run(request.note)
      .then((result) => {
        globalThis.LI.log(`Result: status=${result.status} reason=${result.reason || ""}`);
        sendResponse(result);
      })
      .catch((err) => {
        globalThis.LI.log(`Unhandled error: ${err.message}`, "ERROR");
        sendResponse({ status: "Failed", reason: err.message });
      });
    return true; // ← keeps the port open for async sendResponse
  }

  if (request.action === "ping") {
    sendResponse({ alive: true });
    return false;
  }
});

globalThis.LI.log("Content script loaded and ready.");
} // end of LI_INITIALIZED check
