/**
 * Beacon Identity Resolver — MVP
 *
 * Priority:
 *   1. Google Workspace (Chrome managed profile / school Chromebook)
 *   2. Windows domain  (via background.js -> native messaging host)
 *   3. Device UUID     (persistent fallback)
 */

const IDENTITY_CACHE_KEY = "beaconIdentity";
const CACHE_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

async function resolveIdentity() {
  const cached = await getCachedIdentity();
  if (cached) return cached;

  const deviceId = await getOrCreateDeviceId();

  const identity =
    (await tryGoogleWorkspace()) ||
    (await tryWindowsDomain())   ||
    buildDeviceFallback(deviceId);

  identity.device_id   = deviceId;
  identity.resolved_at = Date.now();

  await chrome.storage.local.set({ [IDENTITY_CACHE_KEY]: identity });
  console.log(`Beacon identity resolved via ${identity.identity_source}:`, identity.student_id);
  return identity;
}

// ─── Provider 1: Google Workspace ────────────────────────────────────────────
async function tryGoogleWorkspace() {
  try {
    if (!chrome.identity?.getProfileUserInfo) return null;

    const info = await new Promise((resolve) => {
      chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }, resolve);
    });

    if (!info?.email || !info.email.includes("@")) return null;
    if (info.email.endsWith("@gmail.com")) return null;

    return {
      student_id:      info.email.toLowerCase(),
      display_name:    info.email,
      identity_source: "google",
    };
  } catch {
    return null;
  }
}

// ─── Provider 2: Windows domain via background service worker ────────────────
async function tryWindowsDomain() {
  try {
    // sendNativeMessage only works in background service worker —
    // so we ask background.js to do it for us via chrome.runtime.sendMessage
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "get_windows_identity" },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn("Beacon background message error:", chrome.runtime.lastError.message);
            resolve(null);
          } else {
            resolve(response);
          }
        }
      );
    });

    if (!response?.success || !response?.username) return null;

    const username = response.username;

    return {
      student_id:      response.upn?.toLowerCase() || username.toLowerCase(),
      display_name:    response.display_name || username,
      identity_source: "windows",
      domain:          response.domain || null,
    };
  } catch (e) {
    console.warn("Beacon tryWindowsDomain error:", e);
    return null;
  }
}

// ─── Provider 3: Device UUID fallback ────────────────────────────────────────
function buildDeviceFallback(deviceId) {
  return {
    student_id:      deviceId,
    display_name:    `Device ${deviceId.slice(4, 12)}`,
    identity_source: "device",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function getOrCreateDeviceId() {
  const result = await chrome.storage.local.get(["beaconDeviceId"]);
  if (result.beaconDeviceId) return result.beaconDeviceId;
  const id = "dev-" + crypto.randomUUID();
  await chrome.storage.local.set({ beaconDeviceId: id });
  return id;
}

async function getCachedIdentity() {
  const result = await chrome.storage.local.get([IDENTITY_CACHE_KEY]);
  const cached = result[IDENTITY_CACHE_KEY];
  if (!cached) return null;
  if (Date.now() - cached.resolved_at > CACHE_TTL_MS) return null;
  return cached;
}

async function clearIdentityCache() {
  await chrome.storage.local.remove([IDENTITY_CACHE_KEY]);
}
