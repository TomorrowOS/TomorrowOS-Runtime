// TomorrowOS HTML5 SDK, API version 7.
// Copy this file into an application package and load it from that app's page.
//
// Connection: the shell loads the application with a one-time `tomorrowos_nonce`
// in the page address. The SDK presents it and receives a private MessageChannel
// port; every later message uses that port. This SDK needs TomorrowOS Runtime
// 1.2.4 or newer; it no longer falls back to window.postMessage.
//
// Multi-page applications: use TomorrowOS.navigate(url), or ordinary <a href>
// links inside the application folder (the SDK carries the nonce for them). A
// page that is opened without the nonce cannot connect to the shell.
(function (root) {
  const API_VERSION = "7";
  const BRIDGE_VERSION = 1;
  const NONCE_PARAM = "tomorrowos_nonce";
  // How long to wait for the shell to answer the connection request.
  const HANDSHAKE_TIMEOUT_MS = 5000;

  const pending = new Map();
  const handlers = new Map();
  const pairingListeners = new Set();
  const playbackListeners = new Set();
  const downloadListeners = new Set();
  const inputListeners = new Set();

  // "pending": waiting for the shell's answer. "channel": private port.
  // "none": not inside a shell. "unconnected": this page has no nonce.
  // "failed": the shell did not answer in time.
  let transport = "pending";
  let port = null;
  let appRoot = "";
  let handshakeTimer = null;
  const outbox = [];

  function readNonce() {
    try {
      return new URL(root.location.href).searchParams.get(NONCE_PARAM) || "";
    } catch {
      return "";
    }
  }

  // The shell's origin, when it has one that can be named (http/https). file://
  // shells have none, so "*" is used; the nonce and port carry the trust there.
  function readShellOrigin() {
    try {
      const ancestors = root.location.ancestorOrigins;
      const origin = ancestors && ancestors.length ? ancestors[0] : "";
      if (/^https?:\/\//i.test(origin)) return origin;
    } catch { /* not available on this engine */ }
    return "*";
  }

  const nonce = readNonce();
  const shellOrigin = readShellOrigin();

  function directoryOf(url) {
    try {
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      return parsed.href.slice(0, parsed.href.lastIndexOf("/") + 1);
    } catch {
      return "";
    }
  }

  function connectionError() {
    if (transport === "none") return new Error("TomorrowOS shell is not available");
    if (transport === "unconnected") {
      return new Error(
        "This page is not connected to the TomorrowOS shell: it was opened without the shell's nonce. " +
        "Open pages of the application with TomorrowOS.navigate or a plain link. " +
        "TomorrowOS Runtime 1.2.4 or newer is required."
      );
    }
    return new Error(
      "The TomorrowOS shell did not answer the connection request. TomorrowOS Runtime 1.2.4 or newer is required."
    );
  }

  function transmit(message) {
    if (transport === "channel") port.postMessage(message);
    else if (transport === "pending") outbox.push(message);
    else throw connectionError();
  }

  function failQueued() {
    outbox.splice(0).forEach((message) => {
      if (typeof message.id === "string") failRequest(message.id, connectionError());
    });
  }

  function failRequest(id, error) {
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }

  function flushOutbox() {
    outbox.splice(0).forEach((message) => {
      try {
        transmit(message);
      } catch (err) {
        if (typeof message.id === "string") failRequest(message.id, err);
      }
    });
  }

  function answerShell(id, ok, value) {
    const reply = { source: "tomorrowos-app", reply: id, ok };
    if (ok) reply.result = value === undefined ? null : value;
    else reply.error = value;
    try {
      transmit(reply);
    } catch {
      try {
        transmit({
          source: "tomorrowos-app",
          reply: id,
          ok: false,
          error: "Handler result could not be sent to the shell"
        });
      } catch { /* the shell is gone */ }
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

  // One handler for everything the shell sends over the port.
  function onShellMessage(data) {
    if (!data || data.source !== "tomorrowos-runtime") return;
    if (typeof data.request === "string") {
      runHandler(data);
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
  }

  function acceptHandoff(event, data) {
    if (transport === "channel" || transport === "none" || transport === "unconnected") return;
    const offered = event.ports && event.ports[0];
    if (!offered) return;
    if (shellOrigin !== "*" && event.origin !== shellOrigin) return;
    clearTimeout(handshakeTimer);
    port = offered;
    port.onmessage = (portEvent) => onShellMessage(portEvent.data);
    transport = "channel";
    if (typeof data.appRoot === "string") appRoot = data.appRoot;
    flushOutbox();
  }

  root.addEventListener("message", (event) => {
    if (event.source !== root.parent) return;
    const data = event.data;
    // The only message accepted on the window is the port handoff.
    if (data && data.source === "tomorrowos-runtime" && data.handoff === true) {
      acceptHandoff(event, data);
    }
  });

  function startHandshake() {
    const parent = root.parent;
    if (!parent || parent === root) {
      transport = "none";
      return;
    }
    if (!nonce) {
      transport = "unconnected";
      return;
    }
    try {
      parent.postMessage(
        { source: "tomorrowos-app", hello: true, bridge: BRIDGE_VERSION, apiVersion: API_VERSION, nonce },
        shellOrigin
      );
    } catch {
      transport = "failed";
      return;
    }
    handshakeTimer = setTimeout(() => {
      if (transport !== "pending") return;
      transport = "failed";
      failQueued();
    }, HANDSHAKE_TIMEOUT_MS);
  }

  function timeoutFor(method) {
    if (method === "files.download") return 30 * 60 * 1000;
    if (method === "files.extract") return 5 * 60 * 1000;
    if (method === "files.read" || method === "files.write") return 60000;
    return 20000;
  }

  function call(method, args) {
    if (transport === "none" || transport === "unconnected" || transport === "failed") {
      return Promise.reject(connectionError());
    }
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Runtime call timed out"));
      }, timeoutFor(method));
      pending.set(id, { resolve, reject, timer });
      try {
        transmit({ source: "tomorrowos-app", id, method, args: args || {} });
      } catch (err) {
        failRequest(id, err);
      }
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

  // Whether a page address belongs to this application (same folder tree).
  function insideApplication(target) {
    const base = appRoot || directoryOf(root.location.href);
    return Boolean(base) && target.href.indexOf(base) === 0;
  }

  // Opens another page of this application and keeps it connected to the shell.
  function navigate(url) {
    const target = new URL(url, root.location.href);
    if (nonce && insideApplication(target)) target.searchParams.set(NONCE_PARAM, nonce);
    root.location.assign(target.href);
  }

  // Plain links to other pages of the application keep working: the nonce is added
  // when the page changes. Hash-only links, new-tab links, downloads, modified
  // clicks and links out of the application are left to the browser.
  function carryNonceOnLinks(event) {
    if (!nonce || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const origin = event.target;
    const anchor = origin && typeof origin.closest === "function" ? origin.closest("a[href]") : null;
    if (!anchor || anchor.hasAttribute("download")) return;
    const targetAttr = anchor.getAttribute("target");
    if (targetAttr && targetAttr !== "_self") return;
    let target;
    let here;
    try {
      target = new URL(anchor.href, root.location.href);
      here = new URL(root.location.href);
    } catch {
      return;
    }
    if (!/^(file|https?):$/.test(target.protocol)) return;
    here.searchParams.delete(NONCE_PARAM);
    const sameDocument = target.protocol === here.protocol && target.host === here.host
      && target.pathname === here.pathname && target.search === here.search;
    if (sameDocument || !insideApplication(target)) return;
    event.preventDefault();
    target.searchParams.set(NONCE_PARAM, nonce);
    root.location.assign(target.href);
  }

  if (root.document && typeof root.document.addEventListener === "function") {
    root.document.addEventListener("click", carryNonceOnLinks);
  }

  startHandshake();

  root.TomorrowOS = {
    apiVersion: API_VERSION,
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
    ready: () => call("runtime.ready"),
    navigate,
    // "channel", "pending", "unconnected", "failed" or "none". For diagnostics.
    getTransport: () => transport
  };
})(window);
