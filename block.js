// Reads settings from local if we've switched; otherwise from sync
(async function () {
  const params = new URLSearchParams(location.search);
  const originalUrl = params.get("u") || "";
  const hostname = params.get("h") || "this site";

  document.getElementById("blocked-host").textContent = `Blocked: ${hostname}`;

  const DEFAULTS = { imageMode: "bundled", imageUrl: "" };
  async function getSettingsEither() {
    const local = await browser.storage.local.get({ ...DEFAULTS, useLocal: false });
    if (local.useLocal) return { imageMode: local.imageMode, imageUrl: local.imageUrl };
    const sync = await browser.storage.sync.get(DEFAULTS);
    return { imageMode: sync.imageMode, imageUrl: sync.imageUrl };
  }

  const { imageMode, imageUrl } = await getSettingsEither();
  const imgEl = document.getElementById("block-image");
  if (imageMode === "url" && imageUrl) {
    imgEl.src = imageUrl;
  } else {
    imgEl.src = browser.runtime.getURL("images/default.jpg");
  }

  document.getElementById("back").addEventListener("click", () => {
    history.length ? history.back() : window.close();
  });

  document.getElementById("override").addEventListener("click", async () => {
    if (!hostname || !originalUrl) return;
    await browser.runtime.sendMessage({ type: "ALLOW_ONCE", hostname });
    location.replace(originalUrl);
  });
})();