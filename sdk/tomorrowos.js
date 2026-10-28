// TomorrowOS HTML5 SDK, API version 6.
// Copy this file into an application package and load it from that app's page.
(function (root) {
  const pending = new Map();
  const handlers = new Map();
  const pairingListeners = new Set();
  const playbackListeners = new Set();
  const downloadListeners = new Set();
  const inputListeners = new Set();

  function answerShell(id, ok, value) {
    const reply = { source: "tomorrowos-app", reply: id, ok };
    if (ok) reply.result = value === undefined ? null : value;
    else reply.error = value;
    try {
      root.parent.postMessage(reply, "*");
    } catch {
      root.parent.postMessage(
        { source: "tomorrowos-app", reply: id, ok: false, error: "Handler result could not be sent to the shell" },
        "*"
      );
    }
  }

  // The shell asks the app to run a registered handler (content policy, reboot, ...).
  function runHandler(data) {
    const handler = handlers.get(data.name);
    if (!handler) {
      answerShell(data.request, false, `No handler is registered for ${data.name}`);
      return;
    }
    Promise.resolve()
      .then(() => handler(data.payload || {}))
      .then(
        (result) => answerShell(data.request, true, result),
        (err) => answerShell(data.request, false, err?.message || String(err || "Handler failed"))
      );
  }

  root.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "tomorrowos-runtime") return;
    if (typeof data.request === "string") {
      if (event.source === root.parent) runHandler(data);
      return;
    }
    const eventListeners = {
      pairing: pairingListeners,
      playback: playbackListeners,
      download: downloadListeners,
      input: inputListeners
    };
    if (eventListeners[data.event]) {
      eventListeners[data.event].forEach((listener) => {
        try { listener(data.data || {}); } catch { /* listener errors stay in the app */ }
      });
      return;
    }
    if (!pending.has(data.id)) return;
    const waiter = pending.get(data.id);
    pending.delete(data.id);
    clearTimeout(waiter.timer);
    if (data.ok) waiter.resolve(data.result);
    else waiter.reject(new Error(data.error || "Runtime call failed"));
  });

  function timeoutFor(method) {
    if (method === "files.download") return 30 * 60 * 1000;
    if (method === "files.extract") return 5 * 60 * 1000;
    if (method === "files.read" || method === "files.write") return 60000;
    return 20000;
  }

  function call(method, args) {
    const parent = root.parent;
    if (!parent || parent === root) {
      return Promise.reject(new Error("TomorrowOS shell is not available"));
    }
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Runtime call timed out"));
      }, timeoutFor(method));
      pending.set(id, { resolve, reject, timer });
      parent.postMessage(
        { source: "tomorrowos-app", id, method, args: args || {} },
        "*"
      );
    });
  }

  // One handler per name. Registering again replaces the previous handler.
  function register(name, handler) {
    if (!name) throw new Error("Handler name is required");
    if (typeof handler !== "function") throw new Error("Handler must be a function");
    handlers.set(name, handler);
    call("runtime.handle", { name, enabled: true }).catch(() => {});
    return () => {
      if (handlers.get(name) !== handler) return;
      handlers.delete(name);
      call("runtime.handle", { name, enabled: false }).catch(() => {});
    };
  }

  root.TomorrowOS = {
    apiVersion: "6",
    call,
    getInfo: () => call("device.getInfo"),
    getCapabilities: () => call("device.getCapabilities"),
    reboot: () => call("device.reboot"),
    captureScreen: () => call("device.captureScreen"),
    setPanelMute: (muted) => call("device.setPanelMute", { muted }),
    setPowerSchedule: (schedule) => call("device.setPowerSchedule", schedule || { clear: true }),
    getOrientation: () => call("display.getOrientation"),
    play: (url, seekMs, options) => call("playback.play", {
      url,
      seekMs,
      rotationDeg: options?.rotationDeg
    }),
    stop: () => call("playback.stop"),
    getPlaybackState: () => call("playback.getState"),
    onPlaybackEvent: (listener) => {
      playbackListeners.add(listener);
      return () => playbackListeners.delete(listener);
    },
    downloadFile: (url, options) => call("files.download", { url, fileName: options?.fileName }),
    cancelDownload: () => call("files.cancelDownload"),
    onDownloadProgress: (listener) => {
      downloadListeners.add(listener);
      return () => downloadListeners.delete(listener);
    },
    readFile: (path) => call("files.read", { path }),
    writeFile: (path, text) => call("files.write", { path, text }),
    removeFile: (path) => call("files.remove", { path }),
    fileExists: (path) => call("files.exists", { path }),
    extractArchive: (path, options) => call("files.extract", {
      path,
      folder: options?.folder,
      entry: options?.entry
    }),
    onRemoteKey: (listener) => {
      inputListeners.add(listener);
      return () => inputListeners.delete(listener);
    },
    connectCms: (cmsEndpoint) => call("pairing.connect", { cmsEndpoint }),
    getPairingState: () => call("pairing.getState"),
    disconnectCms: () => call("pairing.disconnect"),
    forgetCmsPairing: () => call("pairing.forget"),
    sendCmsMessage: (message) => call("pairing.send", { message }),
    onPairingEvent: (listener) => {
      pairingListeners.add(listener);
      return () => pairingListeners.delete(listener);
    },
    // CMS commands. The shell answers the CMS; the handler only does the app's part.
    onContentPolicy: (handler) => register("device.content.setPolicy", handler),
    onContentClear: (handler) => register("device.content.clear", handler),
    onBeforeReboot: (handler) => register("beforeReboot", handler),
    onCommand: (method, handler) => register(String(method || "").trim(), handler),
    getContext: () => call("runtime.getContext"),
    openSetup: () => call("runtime.openSetup"),
    ready: () => call("runtime.ready")
  };
})(window);
