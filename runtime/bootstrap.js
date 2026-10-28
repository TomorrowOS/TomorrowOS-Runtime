(function (root) {
  const RT = root.TomorrowOSRuntime || (root.TomorrowOSRuntime = {});

  const frame = () => document.getElementById("externalAppFrame");
  let unbindSetup = function () {};
  let detachRecovery = function () {};
  let launchGeneration = 0;
  let activeContext = {
    mode: "shell",
    sourceUrl: "",
    appId: "",
    version: "",
    entry: ""
  };

  function config() {
    return root.TOMORROWOS_RUNTIME_CONFIG || {};
  }

  function shellName() {
    return config().shellName || "Signage";
  }

  function setMode(mode) {
    document.documentElement.dataset.runtime = mode;
  }

  function setStatus(message, detail) {
    const title = document.getElementById("runtimeStatusTitle");
    const body = document.getElementById("runtimeStatusMessage");
    const extra = document.getElementById("runtimeStatusDetail");
    if (title) title.textContent = shellName();
    if (body) body.textContent = message || "Starting…";
    if (extra) extra.textContent = detail || "";
  }

  function showStatus(message, detail) {
    unbindSetup();
    setMode("status");
    setStatus(message, detail);
    attachRecovery();
  }

  function showSetup(source) {
    launchGeneration += 1;
    detachRecovery();
    RT.resetGuestHandlers();
    const appFrame = frame();
    if (appFrame) {
      appFrame.src = "about:blank";
    }
    setMode("setup");
    unbindSetup();
    unbindSetup = RT.bindSourceSetup({
      shellName: shellName(),
      locked: !!(source && source.locked),
      initialUrl: source && source.sourceUrl ? source.sourceUrl : "",
      onUseBuiltin() {
        RT.writeAppSource({ decided: true, sourceUrl: "", locked: false });
        openBuiltin();
      },
      onSave(sourceUrl, manifest) {
        const locked = !!(config().lockAppSource && config().appSourceUrl);
        RT.writeAppSource({ decided: true, sourceUrl, locked });
        return startExternal(sourceUrl, manifest);
      }
    });
  }

  function attachRecovery() {
    detachRecovery();
    let count = 0;
    let timer = null;
    function onKey(event) {
      if (document.documentElement.dataset.runtime !== "status") return;
      const isZero = event.key === "0" || event.keyCode === 48 || event.keyCode === 96;
      if (!isZero) {
        count = 0;
        return;
      }
      count += 1;
      clearTimeout(timer);
      timer = setTimeout(() => {
        count = 0;
      }, 2500);
      if (count < 4) return;
      count = 0;
      event.preventDefault();
      openSetup();
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keydown", onRuntimeAddressKey, true);
    detachRecovery = () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", onRuntimeAddressKey, true);
      clearTimeout(timer);
      clearTimeout(runtimeAddressTimer);
    };
  }

  let runtimeAddressCount = 0;
  let runtimeAddressTimer = null;
  function onRuntimeAddressKey(event) {
    if (document.documentElement.dataset.runtime !== "status") return;
    const isNine = event.key === "9" || event.keyCode === 57 || event.keyCode === 105;
    if (!isNine) {
      runtimeAddressCount = 0;
      return;
    }
    runtimeAddressCount += 1;
    clearTimeout(runtimeAddressTimer);
    runtimeAddressTimer = setTimeout(() => {
      runtimeAddressCount = 0;
    }, 2500);
    if (runtimeAddressCount < 4) return;
    runtimeAddressCount = 0;
    event.preventDefault();
    try { localStorage.setItem("tomorrowos.openRuntimeSetup", "1"); } catch { /* ignore */ }
    root.location.reload();
  }

  function openSetup() {
    const current = RT.readAppSource();
    const cfg = config();
    if (cfg.lockAppSource && cfg.appSourceUrl) {
      showSetup({
        decided: true,
        sourceUrl: cfg.appSourceUrl,
        locked: true
      });
      return;
    }
    showSetup({
      decided: true,
      sourceUrl: current.sourceUrl || "",
      locked: false
    });
  }

  function openBuiltin() {
    const host = root.TomorrowOSHost;
    if (typeof host?.openBuiltin === "function") {
      host.openBuiltin();
      return;
    }
    root.location.replace("builtin/index.html");
  }

  function createPlatform() {
    const host = root.TomorrowOSHost;
    if (typeof host?.createAppPlatform !== "function") {
      throw new Error("TomorrowOS host is not available");
    }
    return host.createAppPlatform();
  }

  // The signed document has to stay on this shell. Loading a downloaded
  // index.html as the top-level page would leave the WGT privilege context,
  // which drops webapis, download, and filesystem access. The guest runs in
  // an iframe; device calls come back through the bridge.
  function launchExternal(sourceUrl, record, canRollback, detail) {
    const generation = ++launchGeneration;
    activeContext = {
      mode: "external",
      sourceUrl,
      appId: record.appId || "",
      version: record.version || "",
      entry: record.entry || ""
    };
    detachRecovery();
    unbindSetup();
    const appFrame = frame();
    if (!appFrame || !record.entryUrl) {
      fallbackBuiltin("The installed application has no entry point.");
      return;
    }

    let rolledBack = false;
    const platform = createPlatform();

    function reveal() {
      if (generation !== launchGeneration) return;
      setMode("external");
      try { appFrame.focus(); } catch { /* ignore */ }
      RT.exposeSameOriginApi(appFrame, bridgeContext);
    }

    async function failActivation() {
      if (generation !== launchGeneration || rolledBack) {
        if (generation === launchGeneration) fallbackBuiltin("The application could not be opened.");
        return;
      }
      if (!canRollback) {
        rolledBack = true;
        fallbackBuiltin("The installed application could not be opened.");
        return;
      }
      rolledBack = true;
      const restored = RT.rollbackInstalledApp(sourceUrl);
      if (restored?.broken && restored.broken.rootPath !== restored.active?.rootPath && typeof platform.discard === "function") {
        try { await platform.discard(restored.broken); } catch { /* ignore */ }
      }
      if (restored?.active && (await platform.entryExists(restored.active))) {
        showStatus("The new application failed to open. Restoring the previous version…");
        appFrame.removeEventListener("error", onError);
        launchExternal(sourceUrl, restored.active, false);
        return;
      }
      fallbackBuiltin("The application could not be opened.");
    }

    function onError() {
      void failActivation();
    }

    appFrame.addEventListener("load", () => {
      if (generation !== launchGeneration) return;
      if (appFrame.src === "about:blank") return;
      reveal();
    }, { once: true });
    appFrame.addEventListener("error", onError, { once: true });
    setMode("status");
    setStatus(
      `Starting ${record.appId || "application"} ${record.version || ""}…`.replace(/\s+/g, " ").trim(),
      detail || ""
    );
    RT.resetGuestHandlers();
    appFrame.src = record.entryUrl;
  }

  function fallbackBuiltin(detail) {
    launchGeneration += 1;
    showStatus("Starting the built-in application…", detail || "");
    root.setTimeout(() => {
      openBuiltin();
    }, 1200);
  }

  const bridgeContext = {
    getFrame: frame,
    getContext: () => activeContext,
    openSetup() {
      openSetup();
      return Promise.resolve();
    }
  };

  async function startExternal(sourceUrl, manifest) {
    showStatus("Checking the application…");
    const platform = createPlatform();
    try {
      const outcome = await RT.runAppUpdate({
        sourceUrl,
        manifest: manifest || null,
        platform,
        onStatus(message) {
          setStatus(message);
        },
        onUpdated(record) {
          if (document.documentElement.dataset.runtime === "setup") return;
          launchExternal(sourceUrl, record, true, `Updated to ${record.version}`);
        }
      });
      if (outcome.updateError) {
        setStatus(
          outcome.fromCache
            ? "Update failed. Starting the last installed application…"
            : "Starting the application…",
          outcome.updateError
        );
      }
      if (document.documentElement.dataset.runtime === "setup") return;
      const detail = outcome.updateError
        ? outcome.updateError
        : (outcome.fromCache ? "" : `Updated to ${outcome.record.version}`);
      launchExternal(sourceUrl, outcome.record, true, detail);
    } catch (err) {
      if (document.documentElement.dataset.runtime === "setup") return;
      console.error("[AppRuntime] external start failed", err);
      fallbackBuiltin(err?.message || "The application could not be started.");
    }
  }

  function applyPredefined(source) {
    const cfg = config();
    const predefined = String(cfg.appSourceUrl || "").trim();
    if (!predefined) return source;
    if (cfg.lockAppSource || !source.decided) {
      return RT.writeAppSource({
        decided: true,
        sourceUrl: predefined,
        locked: cfg.lockAppSource === true
      });
    }
    return source;
  }

  function boot() {
    root.TomorrowOSShell = { openSetup };
    RT.installPlatformBridge(bridgeContext);
    const params = new URLSearchParams(root.location.search);
    const forceSetup = params.get("setup") === "1";
    let source = applyPredefined(RT.readAppSource());

    if (forceSetup) {
      showSetup(source.decided ? source : { decided: false, sourceUrl: source.sourceUrl, locked: source.locked });
      return;
    }
    if (!source.decided) {
      showSetup(source);
      return;
    }
    if (!source.sourceUrl) {
      openBuiltin();
      return;
    }
    void startExternal(source.sourceUrl, null);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
