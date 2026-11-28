(function (root) {
  const RT = root.TomorrowOSRuntime || (root.TomorrowOSRuntime = {});

  const ALLOWED = {
    "device.getInfo": true,
    "device.getCapabilities": true,
    "device.reboot": true,
    "device.captureScreen": true,
    "device.setPanelMute": true,
    "device.setPowerSchedule": true,
    "display.getOrientation": true,
    "playback.play": true,
    "playback.stop": true,
    "playback.getState": true,
    "pairing.connect": true,
    "pairing.getState": true,
    "pairing.disconnect": true,
    "pairing.forget": true,
    "pairing.send": true,
    "files.exists": true,
    "files.extract": true,
    "files.download": true,
    "files.cancelDownload": true,
    "files.read": true,
    "files.write": true,
    "files.remove": true,
    "runtime.getContext": true,
    "runtime.openSetup": true,
    "runtime.handle": true,
    "runtime.ready": true
  };

  let pairing = null;
  const guestHandlers = new Set();
  const guestRequests = new Map();
  let guestRequestCount = 0;

  // The bridge to the application running in the iframe.
  //
  //   "channel"   The page proved it holds this launch's nonce and received a
  //               private MessageChannel port. All traffic uses that port, so a
  //               page navigated into the frame later never receives it.
  //   "waiting"   Launched, but no page has presented the nonce yet.
  //   "closed"    No application is running.
  //
  // The only thing the shell accepts on the window is a hello that carries the
  // launch's nonce. Everything else, including requests from applications built
  // with SDK API version 6 or earlier, is ignored.
  const BRIDGE_VERSION = 1;
  const NONCE_PARAM = "tomorrowos_nonce";
  const CONNECT_WARNING_MS = 5000;
  const session = {
    mode: "closed",
    nonce: "",
    expectedOrigin: "",
    appRoot: "",
    port: null,
    warnTimer: null
  };

  function randomNonce() {
    const bytes = new Uint8Array(16);
    if (root.crypto && typeof root.crypto.getRandomValues === "function") {
      root.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  // Only http(s) pages have an origin that can be named. file:// pages do not.
  function httpOrigin(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : "";
    } catch {
      return "";
    }
  }

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

  function withNonce(url, nonce) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set(NONCE_PARAM, nonce);
      return parsed.href;
    } catch {
      return `${url}${String(url).includes("?") ? "&" : "?"}${NONCE_PARAM}=${nonce}`;
    }
  }

  function closeSessionPort() {
    if (!session.port) return;
    try {
      session.port.onmessage = null;
      session.port.close();
    } catch { /* the port is already gone */ }
    session.port = null;
  }

  function endAppSession() {
    closeSessionPort();
    clearTimeout(session.warnTimer);
    session.warnTimer = null;
    session.mode = "closed";
    session.nonce = "";
    session.expectedOrigin = "";
    session.appRoot = "";
  }

  // Starts a launch and returns the address to load. The nonce travels in the
  // page address, so only the page the shell loaded (or a page that application
  // passes it to) can prove it belongs to this launch.
  function beginAppSession(entryUrl) {
    endAppSession();
    session.mode = "waiting";
    session.nonce = randomNonce();
    session.expectedOrigin = httpOrigin(entryUrl);
    session.appRoot = directoryOf(entryUrl);
    return withNonce(entryUrl, session.nonce);
  }

  // Called when the application's first page has loaded. If it has not connected
  // shortly after, say why in the console: the likely cause is an application
  // whose tomorrowos.js is older than API version 7.
  function noteAppLoaded(context) {
    if (session.mode !== "waiting" || session.warnTimer) return;
    session.warnTimer = setTimeout(() => {
      session.warnTimer = null;
      if (session.mode !== "waiting") return;
      const current = (context && context.getContext && context.getContext()) || {};
      console.error(
        "[TomorrowOS] The application has not connected. It needs tomorrowos.js API version 7 or newer.",
        current.appId || "",
        current.version || ""
      );
    }, CONNECT_WARNING_MS);
  }

  // Sends one message to the application over its private port.
  function sendToGuest(context, message) {
    if (session.mode !== "channel" || !session.port) return false;
    try {
      session.port.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  function postToGuest(context, fields) {
    sendToGuest(context, { source: "tomorrowos-runtime", ...fields });
  }

  // Handlers belong to one loaded application; a new application registers its own.
  function resetGuestHandlers() {
    guestHandlers.clear();
    guestRequests.forEach((waiter) => {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("The application was replaced"));
    });
    guestRequests.clear();
  }

  function askGuest(context, name, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      guestRequestCount += 1;
      const id = `shell-${Date.now()}-${guestRequestCount}`;
      const timer = setTimeout(() => {
        guestRequests.delete(id);
        reject(new Error(`The application did not answer ${name}`));
      }, timeoutMs);
      guestRequests.set(id, { resolve, reject, timer });
      const sent = sendToGuest(context, {
        source: "tomorrowos-runtime",
        request: id,
        name,
        payload: payload || {}
      });
      if (!sent) {
        guestRequests.delete(id);
        clearTimeout(timer);
        reject(new Error("The application is not running"));
      }
    });
  }

  function settleGuestRequest(data) {
    const waiter = guestRequests.get(data.reply);
    if (!waiter) return;
    guestRequests.delete(data.reply);
    clearTimeout(waiter.timer);
    if (data.ok) waiter.resolve(data.result);
    else waiter.reject(new Error(data.error || "The application could not complete the request"));
  }

  function hostApi() {
    const host = root.TomorrowOSHost;
    if (!host) throw new Error("TomorrowOS host is not available");
    return host;
  }

  function deviceInfo() {
    try {
      const info = root.TomorrowOSHost?.getInfo?.() || {};
      return {
        uptimeSec: info.uptimeSec ?? null,
        online: root.navigator ? root.navigator.onLine !== false : null,
        deviceId: info.deviceId || null,
        model: info.model || null,
        firmware: info.firmware || null,
        serialNumber: info.serialNumber || null,
        platform: info.platform || "browser"
      };
    } catch (err) {
      return {
        platform: "browser",
        error: err?.message || String(err)
      };
    }
  }

  function systemOrientation() {
    try {
      const type = root.screen?.orientation?.type;
      if (type) return { type, angle: root.screen.orientation.angle };
    } catch { /* ignore */ }
    const width = root.innerWidth || 0;
    const height = root.innerHeight || 0;
    return {
      type: height > width ? "portrait" : "landscape",
      angle: null
    };
  }

  async function invokePlatform(method, args, context) {
    if (!ALLOWED[method]) throw new Error(`Unknown runtime method: ${method}`);
    if (method === "runtime.ready") return { ok: true };
    if (method === "device.getInfo") return deviceInfo();
    if (method === "display.getOrientation") return systemOrientation();
    if (method === "runtime.getContext") {
      const current = context.getContext() || {};
      const config = root.TOMORROWOS_RUNTIME_CONFIG || {};
      return {
        mode: current.mode || "external",
        shellName: config.shellName || "",
        runtimeVersion: config.runtimeVersion || "",
        sourceUrl: current.sourceUrl || "",
        appId: current.appId || "",
        version: current.version || "",
        entry: current.entry || "",
        bridgeMode: session.mode
      };
    }
    if (method === "runtime.openSetup") {
      await context.openSetup();
      return { ok: true };
    }
    if (method === "runtime.handle") {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) throw new Error("Handler name is required");
      if (args.enabled === false) guestHandlers.delete(name);
      else guestHandlers.add(name);
      return { ok: true };
    }
    if (method === "device.reboot") return hostApi().reboot();
    if (method === "device.captureScreen") return hostApi().captureScreen();
    if (method === "device.setPanelMute") return hostApi().setPanelMute(args.muted);
    if (method === "device.setPowerSchedule") return hostApi().setPowerSchedule(args);
    if (method === "playback.play") return hostApi().play(args);
    if (method === "playback.stop") return hostApi().stop();
    if (method === "playback.getState") return hostApi().getPlaybackState();
    if (method === "pairing.getState") return pairing.getState();
    if (method === "pairing.connect") return pairing.connect(args.cmsEndpoint);
    if (method === "pairing.disconnect") return pairing.disconnect();
    if (method === "pairing.forget") return pairing.forget();
    if (method === "pairing.send") return pairing.send(args.message);
    if (method === "device.getCapabilities") return hostApi().getCapabilities();
    if (method === "files.exists") return hostApi().statFile(args);
    if (method === "files.extract") return hostApi().extractArchive(args);
    if (method === "files.download") {
      return hostApi().downloadFile(args, (progress) => {
        postToGuest(context, { event: "download", data: progress });
      });
    }
    if (method === "files.cancelDownload") return hostApi().cancelDownload();
    if (method === "files.read") return hostApi().readFile(args);
    if (method === "files.write") return hostApi().writeFile(args);
    if (method === "files.remove") return hostApi().removeFile(args);
    throw new Error(`Unhandled runtime method: ${method}`);
  }

  function installPlatformBridge(context) {
    if (root.__tomorrowOsBridgeInstalled) return;
    root.__tomorrowOsBridgeInstalled = true;
    const host = root.TomorrowOSHost;
    if (typeof host?.restorePowerSchedule === "function") {
      try { host.restorePowerSchedule(); } catch { /* a missing schedule is not a startup failure */ }
    }
    const router = RT.createCmsCommandRouter({
      guest: {
        has: (name) => guestHandlers.has(name),
        ask: (name, payload, timeoutMs) => askGuest(context, name, payload, timeoutMs)
      },
      deviceInfo() {
        const current = context.getContext() || {};
        const config = root.TOMORROWOS_RUNTIME_CONFIG || {};
        return {
          ...deviceInfo(),
          runtimeVersion: config.runtimeVersion || "",
          appId: current.appId || "",
          appVersion: current.version || ""
        };
      },
      disconnect: () => pairing.disconnect()
    });
    pairing = RT.createPairingSession({
      onEvent(data) {
        postToGuest(context, { event: "pairing", data });
      },
      onCommand: (msg) => router.handle(msg)
    });
    if (typeof host?.onPlayback === "function") {
      host.onPlayback((data) => {
        postToGuest(context, { event: "playback", data });
      });
    }
    if (typeof host?.onRemoteKey === "function") {
      host.onRemoteKey((data) => {
        postToGuest(context, { event: "input", data });
      });
    }

    root.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || data.source !== "tomorrowos-app") return;
      if (session.mode === "closed") return;
      const frame = context.getFrame();
      if (!frame || event.source !== frame.contentWindow) return;
      // When the application is served from http(s) its origin is known, so a
      // page from any other origin is ignored.
      if (session.expectedOrigin && event.origin !== session.expectedOrigin) return;

      // The window carries nothing but the handshake. Requests arrive on the port.
      if (data.hello === true) acceptHello(event, data, context);
    });
  }

  // A request from the application. respond() answers over the port it arrived on.
  function handleAppMessage(data, respond, context) {
    if (typeof data.reply === "string") {
      settleGuestRequest(data);
      return;
    }
    if (typeof data.method !== "string") return;

    const requestId = data.id;
    Promise.resolve()
      .then(() => invokePlatform(data.method, data.args || {}, context))
      .then((result) => {
        respond({ source: "tomorrowos-runtime", id: requestId, ok: true, result });
      })
      .catch((err) => {
        respond({
          source: "tomorrowos-runtime",
          id: requestId,
          ok: false,
          error: err?.message || "Runtime call failed"
        });
      });
  }

  // The SDK announces itself with the launch's nonce. A page that does not know
  // the nonce is ignored and receives no port.
  function acceptHello(event, data, context) {
    if (!session.nonce || typeof data.nonce !== "string" || data.nonce !== session.nonce) return;

    // A valid hello on an open channel means the page reloaded: it is a new
    // document with no handlers registered yet.
    const replacing = Boolean(session.port);
    closeSessionPort();
    if (replacing) resetGuestHandlers();
    clearTimeout(session.warnTimer);
    session.warnTimer = null;
    session.mode = "channel";

    const channel = new MessageChannel();
    session.port = channel.port1;
    channel.port1.onmessage = (portEvent) => {
      const message = portEvent.data;
      if (!message || message.source !== "tomorrowos-app") return;
      handleAppMessage(message, (reply) => {
        try { channel.port1.postMessage(reply); } catch { /* the page is gone */ }
      }, context);
    };
    event.source.postMessage(
      { source: "tomorrowos-runtime", handoff: true, bridge: BRIDGE_VERSION, appRoot: session.appRoot },
      session.expectedOrigin || "*",
      [channel.port2]
    );
  }

  RT.invokePlatform = invokePlatform;
  RT.installPlatformBridge = installPlatformBridge;
  RT.resetGuestHandlers = resetGuestHandlers;
  RT.beginAppSession = beginAppSession;
  RT.endAppSession = endAppSession;
  RT.noteAppLoaded = noteAppLoaded;
})(typeof globalThis !== "undefined" ? globalThis : this);
