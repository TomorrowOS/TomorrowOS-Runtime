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

  function postToGuest(context, fields) {
    const frame = context.getFrame();
    const target = frame && frame.contentWindow;
    if (!target) return;
    target.postMessage({ source: "tomorrowos-runtime", ...fields }, "*");
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
      const frame = context.getFrame();
      const target = frame && frame.contentWindow;
      if (!target) {
        reject(new Error("The application is not running"));
        return;
      }
      guestRequestCount += 1;
      const id = `shell-${Date.now()}-${guestRequestCount}`;
      const timer = setTimeout(() => {
        guestRequests.delete(id);
        reject(new Error(`The application did not answer ${name}`));
      }, timeoutMs);
      guestRequests.set(id, { resolve, reject, timer });
      target.postMessage({ source: "tomorrowos-runtime", request: id, name, payload: payload || {} }, "*");
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
        entry: current.entry || ""
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
        names: () => Array.from(guestHandlers),
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
      const frame = context.getFrame();
      if (!frame || event.source !== frame.contentWindow) return;
      if (typeof data.reply === "string") {
        settleGuestRequest(data);
        return;
      }
      if (typeof data.method !== "string") return;

      const requestId = data.id;
      Promise.resolve()
        .then(() => invokePlatform(data.method, data.args || {}, context))
        .then((result) => {
          event.source.postMessage(
            { source: "tomorrowos-runtime", id: requestId, ok: true, result },
            "*"
          );
        })
        .catch((err) => {
          event.source.postMessage(
            {
              source: "tomorrowos-runtime",
              id: requestId,
              ok: false,
              error: err?.message || "Runtime call failed"
            },
            "*"
          );
        });
    });
  }

  function exposeSameOriginApi(frame, context) {
    try {
      const guest = frame.contentWindow;
      if (!guest || guest.TomorrowOS) return;
      guest.TomorrowOS = {
        apiVersion: "6",
        call(method, args) {
          return invokePlatform(method, args || {}, context);
        },
        getInfo() { return this.call("device.getInfo"); },
        getCapabilities() { return this.call("device.getCapabilities"); },
        reboot() { return this.call("device.reboot"); },
        getOrientation() { return this.call("display.getOrientation"); },
        getContext() { return this.call("runtime.getContext"); },
        openSetup() { return this.call("runtime.openSetup"); },
        ready() { return this.call("runtime.ready"); },
        captureScreen() { return this.call("device.captureScreen"); },
        setPanelMute(muted) { return this.call("device.setPanelMute", { muted }); },
        setPowerSchedule(schedule) { return this.call("device.setPowerSchedule", schedule || { clear: true }); },
        play(url, seekMs, options) {
          return this.call("playback.play", { url, seekMs, rotationDeg: options?.rotationDeg });
        },
        stop() { return this.call("playback.stop"); },
        getPlaybackState() { return this.call("playback.getState"); },
        cancelDownload() { return this.call("files.cancelDownload"); },
        readFile(path) { return this.call("files.read", { path }); },
        writeFile(path, text) { return this.call("files.write", { path, text }); },
        removeFile(path) { return this.call("files.remove", { path }); },
        fileExists(path) { return this.call("files.exists", { path }); },
        extractArchive(path, options) {
          return this.call("files.extract", { path, folder: options?.folder, entry: options?.entry });
        },
        connectCms(cmsEndpoint) { return this.call("pairing.connect", { cmsEndpoint }); },
        getPairingState() { return this.call("pairing.getState"); },
        disconnectCms() { return this.call("pairing.disconnect"); },
        forgetCmsPairing() { return this.call("pairing.forget"); },
        sendCmsMessage(message) { return this.call("pairing.send", { message }); }
      };
    } catch {
      // Cross-origin file packages use postMessage instead of this injection.
    }
  }

  RT.invokePlatform = invokePlatform;
  RT.installPlatformBridge = installPlatformBridge;
  RT.resetGuestHandlers = resetGuestHandlers;
  RT.exposeSameOriginApi = exposeSameOriginApi;
})(typeof globalThis !== "undefined" ? globalThis : this);
