// options.js — single add + bulk import/export with sync→local fallback

const DEFAULTS = { blockedHosts: [], imageMode: "bundled", imageUrl: "" };

// ---- storage helpers (mirror background.js) ----
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
      // Permanently switch to local
      await browser.storage.local.set({ useLocal: true });
      area = browser.storage.local;
      await area.set(partial);
      const note = document.getElementById("bulk-status") || document.getElementById("sync-status");
      if (note) note.textContent = "Switched to local storage due to sync quota. All good 👍";
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

// ---- helpers & UI ----
function normalizeHost(v) {
  try {
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return new URL(v).hostname.toLowerCase();
    return v.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  } catch {
    return (v || "").trim().toLowerCase();
  }
}

function parseBulk(text) {
  return Array.from(new Set(
    (text || "").split(/[\n,\s]+/g)
      .map(normalizeHost)
      .filter(Boolean)
  ));
}

async function render() {
  const { imageMode, imageUrl } = await getSettings();
  const blockedHosts = await getBlockedHosts();

  const list = document.getElementById("list");
  if (list) {
    list.innerHTML = "";
    blockedHosts.forEach(h => {
      const li = document.createElement("li");
      li.textContent = h;
      const btn = document.createElement("button");
      btn.textContent = "Remove";
      btn.addEventListener("click", async () => {
        const next = blockedHosts.filter(x => x !== h);
        await setBlockedHosts(next);
        render();
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  document.querySelectorAll('input[name="imageMode"]').forEach(r => {
    r.checked = (r.value === imageMode);
  });
  const imgUrlEl = document.getElementById("imageUrl");
  if (imgUrlEl) imgUrlEl.value = imageUrl || "";
}

async function init() {
  await render();

  // Single add
  document.getElementById("add-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const hostInput = document.getElementById("host");
    const host = normalizeHost(hostInput.value);
    if (!host) return;
    const list = await getBlockedHosts();
    await setBlockedHosts([...list, host]);
    hostInput.value = "";
    render();
  });

  // Bulk add (textarea)
  document.getElementById("bulk-add")?.addEventListener("click", async () => {
    const text = document.getElementById("bulk").value || "";
    const items = parseBulk(text);
    const status = document.getElementById("bulk-status");
    if (!items.length) { if (status) status.textContent = "Nothing to add."; return; }

    const list = await getBlockedHosts();
    const start = list.length;
    await setBlockedHosts([...list, ...items]);
    const end = (await getBlockedHosts()).length;

    document.getElementById("bulk").value = "";
    if (status) status.textContent = `Added ${end - start} new host(s). Total: ${end}.`;
    render();
  });

  // Import from file
  document.getElementById("file")?.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const text = await f.text();
    const items = parseBulk(text);
    const list = await getBlockedHosts();
    const start = list.length;
    await setBlockedHosts([...list, ...items]);
    const end = (await getBlockedHosts()).length;
    const status = document.getElementById("bulk-status");
    if (status) status.textContent = `Imported ${end - start} new host(s). Total: ${end}.`;
    e.target.value = "";
    render();
  });

  // Export current list
  document.getElementById("export")?.addEventListener("click", async () => {
    const list = await getBlockedHosts();
    const blob = new Blob([list.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "blocklist.txt"; a.click();
    URL.revokeObjectURL(url);
  });

  // Save image settings
  document.getElementById("save")?.addEventListener("click", async () => {
    const modeEl = document.querySelector('input[name="imageMode"]:checked');
    const mode = modeEl ? modeEl.value : "bundled";
    const url = (document.getElementById("imageUrl")?.value || "").trim();
    await setSettings({ imageMode: mode, imageUrl: url });
    render();
  });
}

init();