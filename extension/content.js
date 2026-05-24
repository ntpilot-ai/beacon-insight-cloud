console.log("Beacon Sentinel v8.3 Active");

const SUPABASE_URL     = "https://eyvwvmjcuahduuokpmng.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5dnd2bWpjdWFoZHV1b2twbW5nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMzAxNzEsImV4cCI6MjA5NDgwNjE3MX0.erku-Tq0F2qPmXdjlCZ8v2EMuzm2RokUEwcoRgE0ZlM";
const POLICY_CACHE_TTL = 60 * 1000; // re-fetch every 60 seconds

let BLOCK_UNTIL = 0; // timestamp until which all submissions are blocked


// ─── School config ────────────────────────────────────────────────────────────
// School ID is set once during extension deployment via managed storage or
// manually via chrome.storage.local.set({ beaconSchoolId: "your-school-id" })

async function getSchoolId() {
  const result = await chrome.storage.local.get(["beaconSchoolId"]);
  return result.beaconSchoolId || "beacon-academy";
}

let ACTIVE_POLICIES = null;
let latestPrompt    = "";
let BEACON_IDENTITY = null;

initializePolicies();
initializeIdentity();
checkPeriodMode();
injectBeaconBadge();
monitorLiveInput();

// ─── Policies — fetch from Supabase, fallback to local storage ───────────────

async function initializePolicies() {
  // Load cached policies immediately so we're never unprotected
  const cached = await chrome.storage.local.get(["beaconPolicies", "beaconPoliciesAt"]);
  if (cached.beaconPolicies) {
    ACTIVE_POLICIES = cached.beaconPolicies;
  }

  // Always refresh on first load, then respect TTL
  const age = Date.now() - (cached.beaconPoliciesAt || 0);
  if (age > POLICY_CACHE_TTL || !cached.beaconPolicies || !cached.beaconSettings) {
    await refreshPoliciesFromCloud();
  }

  console.log("Beacon policies loaded", ACTIVE_POLICIES);
}

async function refreshPoliciesFromCloud() {
  try {
    const schoolId = await getSchoolId();

    // Fetch policies and settings in parallel
    const [polRes, setRes] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/beacon_policies?school_id=eq.${schoolId}&select=word,severity`,
        { headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` } }
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/school_settings?school_id=eq.${schoolId}&select=msg_high,msg_medium,badge_text`,
        { headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` } }
      )
    ]);

    // Save settings
    if (setRes.ok) {
      const setData = await setRes.json();
      if (setData?.[0]) {
        await chrome.storage.local.set({ beaconSettings: setData[0] });
        const label = document.getElementById("beacon-badge-label");
        if (label && setData[0].badge_text) {
          label.textContent = setData[0].badge_text;
        }
      }
    }

    // Process policies
    if (!polRes.ok) throw new Error(`HTTP ${polRes.status}`);
    const data = await polRes.json();

    const policies = {
      highRisk:   data.filter(p => p.severity === "high").map(p => p.word),
      mediumRisk: data.filter(p => p.severity === "medium").map(p => p.word),
    };

    if (policies.highRisk.length || policies.mediumRisk.length) {
      ACTIVE_POLICIES = policies;
      await chrome.storage.local.set({
        beaconPolicies:   policies,
        beaconPoliciesAt: Date.now(),
      });
      console.log("Beacon policies synced from cloud", policies);
    }
  } catch (err) {
    console.warn("Beacon policy sync failed, using cached/defaults", err);

    // Hard fallback if nothing cached
    if (!ACTIVE_POLICIES) {
      ACTIVE_POLICIES = {
        highRisk:   ["kill", "bomb", "suicide", "terrorist",
                     "ignore previous instructions", "jailbreak",
                     "act as dan", "do anything now", "pretend you have no limits"],
        mediumRisk: ["violence", "weapon", "hate"],
      };
    }
  }
}

// Listen for policy updates pushed from the Atlas dashboard
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.beaconPolicies) {
    ACTIVE_POLICIES = changes.beaconPolicies.newValue;
    console.log("Beacon policies updated", ACTIVE_POLICIES);
  }
  if (area === "local" && changes.beaconIdentity) {
    BEACON_IDENTITY = changes.beaconIdentity.newValue;
    updateBadgeWithIdentity();
  }
});

// ─── Identity ─────────────────────────────────────────────────────────────────

async function initializeIdentity() {
  try {
    BEACON_IDENTITY = await resolveIdentity();
    console.log(`Beacon identity: ${BEACON_IDENTITY.student_id} (${BEACON_IDENTITY.identity_source})`);
    updateBadgeWithIdentity();
  } catch (err) {
    console.warn("Beacon identity resolution failed", err);
  }
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function injectBeaconBadge() {
  if (document.getElementById("beacon-badge")) return;
  const badge = document.createElement("div");
  badge.id = "beacon-badge";
  badge.innerHTML = `
    <div id="beacon-badge-inner" style="
      position:fixed;bottom:20px;right:20px;
      background:#013B93;color:white;
      padding:10px 16px;border-radius:18px;
      font-family:Arial;font-weight:bold;font-size:13px;
      z-index:999999;box-shadow:0 8px 24px rgba(0,0,0,0.25);
      display:flex;align-items:center;gap:8px;
    ">
      🛡 <span id="beacon-badge-label">Beacon Protected</span>
    </div>
  `;
  document.body.appendChild(badge);
}

async function updateBadgeWithIdentity() {
  const label = document.getElementById("beacon-badge-label");
  if (!label) return;
  const result   = await chrome.storage.local.get(["beaconSettings"]);
  const settings = result.beaconSettings || {};
  const badgeBase = settings.badge_text || "Beacon Protected";
  if (BEACON_IDENTITY) {
    const short = BEACON_IDENTITY.display_name?.split("@")[0] ||
                  BEACON_IDENTITY.student_id?.slice(0, 16) || "";
    label.textContent = short ? `${badgeBase} · ${short}` : badgeBase;
  } else {
    label.textContent = badgeBase;
  }
}

// ─── Input monitoring ─────────────────────────────────────────────────────────

// ─── Period Mode ─────────────────────────────────────────────────────────────

async function checkPeriodMode() {
  try {
    const schoolId = await getSchoolId();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/period_mode?school_id=eq.${schoolId}&active=eq.true&select=*`,
      { headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!res.ok) return;
    const periods = await res.json();

    const now  = new Date();
    const day  = ["sun","mon","tue","wed","thu","fri","sat"][now.getDay()];
    const time = now.toTimeString().slice(0, 5); // "HH:MM"

    for (const period of periods) {
      let isActive = false;

      if (period.mode === "manual") {
        // Manual override — active until override_until or indefinitely
        isActive = !period.override_until || new Date(period.override_until) > now;
      } else if (period.mode === "scheduled") {
        // Scheduled — check day and time window
        isActive = period.days?.includes(day) &&
                   time >= period.start_time?.slice(0, 5) &&
                   time <= period.end_time?.slice(0, 5);
      }

      if (isActive) {
        // Build redirect URL with branding params
        const params = new URLSearchParams({
          title:   period.block_title   || "AI Access Restricted",
          message: period.block_message || "Access to AI tools is currently restricted by your school.",
          school:  schoolId,
        });
        if (period.mode === "scheduled") {
          // Tell student when access will be restored
          const endParts = period.end_time?.slice(0, 5).split(":") || ["15", "30"];
          const until = new Date();
          until.setHours(parseInt(endParts[0]), parseInt(endParts[1]), 0, 0);
          params.set("until", until.toISOString());
        }

        const DASHBOARD_URL = "https://beacon-insight-cloud.vercel.app";
        window.location.replace(`${DASHBOARD_URL}/blocked?${params.toString()}`);
        return;
      }
    }
  } catch (err) {
    console.warn("Beacon: period mode check failed", err);
  }
}

function monitorLiveInput() {
  // Track latest prompt text via input events
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches("textarea") || target.matches("div[contenteditable='true']")) {
      latestPrompt = target.value || target.innerText || target.textContent || "";
    }
  });

  // PRIMARY INTERCEPT: catch form submit — this fires for Enter key AND button click
  // Using capture phase so we run before React's handlers
  document.addEventListener("submit", (event) => {
    const input = document.querySelector("textarea, div[contenteditable='true']");
    const prompt = (input?.value || input?.innerText || input?.textContent || latestPrompt).trim();

    if (!prompt || prompt.length < 2) return;
    if (!ACTIVE_POLICIES) return;

    const result = calculateRisk(prompt);

    if (result.level === "high") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showWarning(result.matched, true);
      logAndSync(prompt, result);
      return false;
    }

    logAndSync(prompt, result);
    if (result.level === "medium") showWarning(result.matched, false);
  }, true);

  // SECONDARY INTERCEPT: keydown Enter — belt and braces alongside submit
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;

    const input = document.querySelector("textarea, div[contenteditable='true']");
    const prompt = (input?.value || input?.innerText || input?.textContent || latestPrompt).trim();

    if (!prompt || prompt.length < 2) return;
    if (!ACTIVE_POLICIES) return;

    const result = calculateRisk(prompt);

    if (result.level === "high") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showWarning(result.matched, true);
      logAndSync(prompt, result);
      return false;
    }

    logAndSync(prompt, result);
    if (result.level === "medium") showWarning(result.matched, false);

  }, true);

  // TERTIARY INTERCEPT: button click — catch send button directly
  document.addEventListener("click", (event) => {
    // Cast a wide net across all AI platforms
    const btn = event.target.closest(
      // ChatGPT
      '[data-testid="send-button"], ' +
      'button[aria-label="Send prompt"], ' +
      'button[aria-label="Send message"], ' +
      // Copilot
      'button[aria-label="Submit message"], ' +
      'button[aria-label="Send"], ' +
      'button[title="Submit"], ' +
      'button[title="Send"], ' +
      '#submit-button, ' +
      // Claude
      'button[aria-label="Send Message"], ' +
      'fieldset button[type="submit"], ' +
      // Gemini
      'button.send-button, ' +
      'button[aria-label="Send message"], ' +
      'mat-icon-button, ' +
      // Generic fallbacks
      'form button[type="submit"], ' +
      '[class*="send-btn"], ' +
      '[class*="sendButton"], ' +
      '[class*="submit-btn"], ' +
      '[class*="submitButton"]'
    );
    if (!btn) return;

    const input = document.querySelector("textarea, div[contenteditable='true']");
    const prompt = (input?.value || input?.innerText || input?.textContent || latestPrompt).trim();

    if (!prompt || prompt.length < 2 || !ACTIVE_POLICIES) return;

    const result = calculateRisk(prompt);
    if (result.level === "high") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showWarning(result.matched, true);
      logAndSync(prompt, result);
      return false;
    }

    logAndSync(prompt, result);
    if (result.level === "medium") showWarning(result.matched, false);
  }, true);

  // QUATERNARY INTERCEPT: fetch monkey-patch — catch the actual API call as last resort
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    try {
      const url = args[0]?.toString() || "";
      // Intercept all AI platform API calls
      const isAICall = (
        // ChatGPT / OpenAI
        url.includes("/backend-api/conversation") ||
        url.includes("/backend-anon/") ||
        url.includes("api.openai.com") ||
        url.includes("chatgpt.com/api") ||
        // Claude
        url.includes("claude.ai/api") ||
        url.includes("/api/organizations") ||
        url.includes("/completion") ||
        // Copilot
        url.includes("copilot.microsoft.com") ||
        url.includes("sydney.bing.com") ||
        url.includes("/turing/") ||
        url.includes("api.bing.microsoft.com") ||
        // Gemini
        url.includes("gemini.google.com") ||
        url.includes("generativelanguage.googleapis.com") ||
        url.includes("bard.google.com")
      );
      if (isAICall) {
        const body = args[1]?.body;
        if (body) {
          const bodyStr = typeof body === "string" ? body : await new Response(body).text();

          if (ACTIVE_POLICIES) {
            const matched = ACTIVE_POLICIES.highRisk.filter(w => matchesWord(bodyStr, w));
            if (matched.length > 0) {
              console.warn("Beacon: API call blocked — matched:", matched);
              showWarning(matched, true);
              logAndSync(latestPrompt, { level: "high", matched });
              // Return a fake response so ChatGPT doesn't error
              return new Response(JSON.stringify({ error: "blocked" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }
          }

          // Reconstruct body for non-blocked requests
          args[1] = { ...args[1], body: bodyStr };
        }
      }
    } catch (e) {
      // Never break normal fetch if something goes wrong
    }
    return originalFetch.apply(this, args);
  };
}

// ─── Prompt evaluation ────────────────────────────────────────────────────────

async function evaluatePrompt(prompt, event) {
  const liveInput = document.querySelector("textarea, div[contenteditable='true']");
  if (liveInput) {
    prompt = liveInput.value || liveInput.innerText || liveInput.textContent || prompt;
  }

  // ── STEP 1: Synchronous keyword check — must happen before any async work ──
  // Policies should already be in memory from initializePolicies()
  const quickResult = calculateRisk(prompt);

  if (quickResult.level === "high") {
    // Block IMMEDIATELY — synchronously, before any awaits
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    // Lock out all further submissions for 3 seconds
    BLOCK_UNTIL = Date.now() + 3000;

    // Clear the input right now
    clearInput(liveInput);

    // Show warning and log async (non-blocking)
    showWarning(quickResult.matched, true);
    logAndSync(prompt, quickResult);

    // Re-clear after a short delay in case React re-renders the input
    setTimeout(() => clearInput(null), 100);
    setTimeout(() => clearInput(null), 300);
    setTimeout(() => { clearInput(null); BLOCK_UNTIL = 0; }, 3000);

    return false;
  }

  // ── STEP 2: Medium/low — log async, show warning if medium ────────────────
  logAndSync(prompt, quickResult);
  if (quickResult.level === "medium") showWarning(quickResult.matched, false);

  // ── STEP 3: Refresh policies in background if stale ───────────────────────
  const cached = await chrome.storage.local.get(["beaconPoliciesAt"]);
  if (Date.now() - (cached.beaconPoliciesAt || 0) > POLICY_CACHE_TTL) {
    refreshPoliciesFromCloud(); // fire and forget
  }
}

function clearInput(input) {
  if (!input) {
    // Try to find it
    input = document.querySelector("textarea, [contenteditable='true']");
  }
  if (!input) return;

  // Textarea
  if (input.value !== undefined) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      input.value = "";
    }
  }

  // ContentEditable (ChatGPT uses this)
  if (input.isContentEditable) {
    input.innerHTML = "";
    input.innerText = "";
    input.textContent = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Also try to clear via execCommand for React-controlled inputs
    input.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
  }
}

let _blockObserver = null;

function startBlockObserver(lockedInput) {
  // Stop any existing observer
  if (_blockObserver) { _blockObserver.disconnect(); _blockObserver = null; }

  const target = lockedInput || document.querySelector("textarea, div[contenteditable='true']");
  if (!target) return;

  _blockObserver = new MutationObserver(() => {
    if (Date.now() < BLOCK_UNTIL) {
      // React restored content — clear it again immediately
      clearInput(target);
    } else {
      // Lock window expired — stop watching
      _blockObserver.disconnect();
      _blockObserver = null;
      BLOCK_UNTIL = 0;
    }
  });

  _blockObserver.observe(target, {
    childList:     true,
    subtree:       true,
    characterData: true,
  });

  // Also watch the parent container for React swapping the element
  if (target.parentElement) {
    const parentObserver = new MutationObserver(() => {
      if (Date.now() < BLOCK_UNTIL) {
        const newInput = document.querySelector("textarea, div[contenteditable='true']");
        if (newInput) clearInput(newInput);
      } else {
        parentObserver.disconnect();
      }
    });
    parentObserver.observe(target.parentElement, { childList: true, subtree: true });
  }

  // Auto-stop after 3 seconds
  setTimeout(() => {
    if (_blockObserver) { _blockObserver.disconnect(); _blockObserver = null; }
    BLOCK_UNTIL = 0;
  }, 3000);
}

async function logAndSync(prompt, result) {
  if (!BEACON_IDENTITY) {
    BEACON_IDENTITY = await resolveIdentity();
    updateBadgeWithIdentity();
  }

  const telemetry = {
    id:        Date.now(),
    timestamp: new Date().toISOString(),
    hostname:  window.location.hostname,
    prompt,
    risk:      result.level,
    blocked:   result.level === "high",
    matched:   result.matched,
  };

  await saveTelemetry(telemetry);
  sendToBeaconCloud(telemetry);
}

// ─── AI Classification ───────────────────────────────────────────────────────

async function classifyWithAI(prompt) {
  try {
    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action:   "classify_prompt",
          prompt,
          keywords: ACTIVE_POLICIES,
        },
        (response) => {
          if (chrome.runtime.lastError || !response) resolve(null);
          else resolve(response);
        }
      );
    });

    if (!result?.risk) return null;

    return {
      level:    result.risk,
      matched:  result.reason ? [result.reason] : [],
      category: result.category || "general",
      ai:       true,
    };
  } catch {
    return null;
  }
}

// ─── Risk calculation ─────────────────────────────────────────────────────────

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesWord(text, keyword) {
  return new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i").test(text);
}

function calculateRisk(prompt) {
  const matched = [];

  ACTIVE_POLICIES.highRisk.forEach(word => { if (matchesWord(prompt, word)) matched.push(word); });
  if (matched.length > 0) return { level: "high", matched };

  ACTIVE_POLICIES.mediumRisk.forEach(word => { if (matchesWord(prompt, word)) matched.push(word); });
  if (matched.length > 0) return { level: "medium", matched };

  return { level: "low", matched: [] };
}

// ─── Storage ──────────────────────────────────────────────────────────────────

async function saveTelemetry(entry) {
  const result  = await chrome.storage.local.get(["beaconPrompts"]);
  const prompts = result.beaconPrompts || [];
  prompts.push(entry);
  await chrome.storage.local.set({ beaconPrompts: prompts });
}

// ─── Cloud sync ───────────────────────────────────────────────────────────────

async function sendToBeaconCloud(telemetry) {
  try {
    const identity = BEACON_IDENTITY || await resolveIdentity();
    await fetch(`${SUPABASE_URL}/rest/v1/beacon_events`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        student_id:      identity.student_id,
        identity_source: identity.identity_source,
        device_id:       identity.device_id,
        display_name:    identity.display_name || null,
        school_id:       await getSchoolId(),
        platform:        window.location.hostname,
        prompt:          telemetry.prompt,
        risk:            telemetry.risk,
        blocked:         telemetry.blocked,
        matched:         telemetry.matched,
        hostname:        telemetry.hostname,
      }),
    });
  } catch (err) {
    console.error("Beacon cloud sync failed", err);
  }
}

// ─── Warning UI ───────────────────────────────────────────────────────────────

async function showWarning(matched, blocked) {
  document.getElementById("beacon-warning")?.remove();

  // Get custom messages from settings
  const result   = await chrome.storage.local.get(["beaconSettings"]);
  const settings = result.beaconSettings || {};
  const message  = blocked
    ? (settings.msg_high   || "This prompt has been blocked by your school\'s safeguarding policy. Please speak to your teacher.")
    : (settings.msg_medium || "This prompt has been flagged by your school\'s safeguarding system. Please consider your usage carefully.");

  const div = document.createElement("div");
  div.id = "beacon-warning";
  div.innerHTML = `
    <div style="
      position:fixed;top:20px;right:20px;
      background:${blocked ? "#DC2626" : "#F59E0B"};
      color:white;padding:18px 22px;border-radius:18px;
      z-index:999999;width:340px;font-family:Arial;
      box-shadow:0 8px 24px rgba(0,0,0,0.3);
    ">
      <div style="font-size:18px;font-weight:bold;margin-bottom:10px;">
        ${blocked ? "🛡 Beacon Blocked Prompt" : "⚠️ Beacon Warning"}
      </div>
      <div style="line-height:1.6;font-size:14px;">${message}</div>
      ${matched.length ? `<div style="margin-top:10px;opacity:0.75;font-size:12px;">Matched: ${matched.join(", ")}</div>` : ""}
    </div>
  `;
  document.body.appendChild(div);
  setTimeout(() => document.getElementById("beacon-warning")?.remove(), 6000);
}
