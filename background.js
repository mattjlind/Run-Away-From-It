// MV3 background — prefers storage.sync, auto-falls back to storage.local on quota

const DEFAULTS = {
  blockedHosts: [],
  imageMode: "bundled", // "bundled" | "url"
  imageUrl: ""
};

// ---- storage helpers (shared pattern) ----
async function getPreferredArea() {
  const { useLocal = false } = await browser.storage.local.get({ useLocal: false });
  return useLocal ? browser.storage.local : browser.storage.sync;
}

async function getSettings() {
  const area = await getPreferredArea();
  try {
    const data = await area.get(DEFAULTS);
    return { ...DEFAULTS, ...data };
  } catch {
    const other = (area === browser.storage.sync) ? browser.storage.local : browser.storage.sync;
    const data = await other.get(DEFAULTS);
    return { ...DEFAULTS, ...data };
  }
}

async function setSettings(partial) {
  let area = await getPreferredArea();
  try {
    await area.set(partial);
  } catch (e) {
    if (String(e && e.message).includes("QuotaExceededError")) {
      await browser.storage.local.set({ useLocal: true });
      area = browser.storage.local;
      await area.set(partial);
    } else {
      throw e;
    }
  }
}

async function getBlockedHosts() {
  const s = await getSettings();
  return Array.isArray(s.blockedHosts) ? s.blockedHosts : [];
}

async function setBlockedHosts(list) {
  await setSettings({ blockedHosts: Array.from(new Set(list)) });
}

// ---- runtime logic ----
let settingsCache = { ...DEFAULTS };
const tempAllow = new Map();

function now() { return Date.now(); }

function matchesHost(blockedHost, hostname) {
  const strip = (h) => h.replace(/^\.+|\.+$/g, "").toLowerCase();
  const a = strip(blockedHost.replace(/^www\./, ""));
  const b = strip(hostname.replace(/^www\./, ""));
  return a === b || b.endsWith("." + a) || a.endsWith("." + b);
}

// Initial load
(async function initSettings() {
  settingsCache = await getSettings();
})();

// Keep cache fresh (both areas)
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" && area !== "local") return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in DEFAULTS) settingsCache[key] = newValue;
  }
});

function isTemporarilyAllowed(hostname) {
  const t = tempAllow.get(hostname);
  if (!t) return false;
  if (t < now()) { tempAllow.delete(hostname); return false; }
  return true;
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "ALLOW_ONCE" && msg.hostname) {
    tempAllow.set(msg.hostname, now() + 60 * 1000);
    return Promise.resolve({ ok: true });
  }
  if (msg && msg.type === "ADD_BLOCK_HOST" && msg.hostname) {
    return (async () => {
      const list = await getBlockedHosts();
      list.push(msg.hostname);
      await setBlockedHosts(list);
      return { ok: true };
    })();
  }
});

browser.runtime.onInstalled.addListener(async () => {
  settingsCache = await getSettings();
  browser.contextMenus.create({
    id: "block-this-site",
    title: "Block this site",
    contexts: ["page", "action"]
  });
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "block-this-site" || !tab || !tab.url) return;
  try {
    const hostname = new URL(tab.url).hostname;
    await browser.runtime.sendMessage({ type: "ADD_BLOCK_HOST", hostname });
  } catch (e) { /* ignore */ }
});

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    try {
      if (details.type !== "main_frame") return {};
      const url = new URL(details.url);
      if (url.protocol === "moz-extension:") return {};

      const blockedHosts = settingsCache.blockedHosts || [];
      const hostname = url.hostname;
      if (isTemporarilyAllowed(hostname)) return {};

      const shouldBlock = blockedHosts.some(h => matchesHost(h, hostname));
      if (!shouldBlock) return {};

      const redirectUrl = browser.runtime.getURL("block.html") +
        "?u=" + encodeURIComponent(details.url) +
        "&h=" + encodeURIComponent(hostname);

      return { redirectUrl };
    } catch {
      return {};
    }
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);