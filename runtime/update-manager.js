(function (root) {
  const RT = root.TomorrowOSRuntime || (root.TomorrowOSRuntime = {});

  const CACHED_MANIFEST_TIMEOUT_MS = 8000;
  const FIRST_MANIFEST_TIMEOUT_MS = 15000;
  const BACKGROUND_WINDOW_MS = 60000;
  const BACKGROUND_PAUSE_MS = 5000;

  async function existingRecord(platform, record) {
    if (!record) return null;
    try {
      if (await platform.entryExists(record)) return record;
    } catch {
      return null;
    }
    return null;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function fetchManifestOnce(sourceUrl, options, timeoutMs) {
    return RT.fetchManifest(sourceUrl, {
      fetchImpl: options.fetchImpl,
      timeoutMs
    });
  }

  // The first request often fails before the network is up. The installed
  // application is already starting; keep checking and reload only that
  // application when a newer package is ready.
  async function backgroundAppUpdate(options, local) {
    const notify = typeof options.onUpdated === "function" ? options.onUpdated : function () {};
    const deadline = Date.now() + BACKGROUND_WINDOW_MS;
    while (Date.now() < deadline) {
      await wait(BACKGROUND_PAUSE_MS);
      let manifest = null;
      try {
        manifest = await fetchManifestOnce(options.sourceUrl, options, CACHED_MANIFEST_TIMEOUT_MS);
      } catch {
        continue;
      }
      if (!RT.isNewerVersion(manifest.version, local.version)) return;
      try {
        const record = await options.platform.install(manifest, {
          sourceUrl: options.sourceUrl,
          onStatus() {}
        });
        if (!(await options.platform.entryExists(record))) continue;
        notify(record);
        return;
      } catch (err) {
        console.warn("[TomorrowOS][runtime] background application update failed:", err?.message || err);
      }
    }
  }

  // Check the manifest, install only when the remote version is newer, and
  // always prefer a validated local copy when the network or package fails.
  async function runAppUpdate(options) {
    const sourceUrl = options.sourceUrl;
    const platform = options.platform;
    const onStatus = typeof options.onStatus === "function" ? options.onStatus : function () {};
    const slot = platform.readSlot(sourceUrl);
    const active = await existingRecord(platform, slot.active);
    const previous = await existingRecord(platform, slot.previous);

    const local = active || previous;
    let manifest = options.manifest || null;
    let manifestError = null;
    if (!manifest && local) {
      onStatus("Checking for application updates…");
      try {
        manifest = await fetchManifestOnce(sourceUrl, options, CACHED_MANIFEST_TIMEOUT_MS);
      } catch {
        onStatus("Starting the installed application…");
        void backgroundAppUpdate(options, local);
        return { record: local, fromCache: true, deferred: true };
      }
    }

    if (!manifest) {
      onStatus("Reading the application manifest…");
      try {
        manifest = await fetchManifestOnce(sourceUrl, options, FIRST_MANIFEST_TIMEOUT_MS);
      } catch (err) {
        manifestError = err;
      }
    }

    if (!manifest) {
      throw manifestError || new Error("Application manifest is unavailable");
    }

    const needInstall = !active || RT.isNewerVersion(manifest.version, active.version);
    if (!needInstall) {
      onStatus("Starting the installed application…");
      return { record: active, fromCache: true, manifest };
    }

    try {
      onStatus(`Downloading ${manifest.appId} ${manifest.version}…`);
      const record = await platform.install(manifest, {
        sourceUrl,
        onStatus
      });
      if (!(await platform.entryExists(record))) {
        throw new Error("Installed application entry point is missing");
      }
      onStatus("Starting the application…");
      return { record, fromCache: false, manifest };
    } catch (err) {
      if (active || previous) {
        onStatus("Update failed. Starting the last installed application…");
        return {
          record: active || previous,
          fromCache: true,
          updateError: err && err.message ? err.message : "Update failed",
          manifest
        };
      }
      throw err;
    }
  }

  RT.runAppUpdate = runAppUpdate;
})(typeof globalThis !== "undefined" ? globalThis : this);
