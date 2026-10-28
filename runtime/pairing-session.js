// Shell-owned TomorrowOS CMS session. The guest draws the code; this session
// speaks device.hello / device.resume, keeps the socket alive, and answers
// CMS commands through options.onCommand.
(function (root) {
  const RT = root.TomorrowOSRuntime || (root.TomorrowOSRuntime = {});
  const STORAGE_KEY = "tomorrowos.runtime.pairing";

  function normalizePairingEndpoint(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) throw new Error("CMS address is required");
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("CMS address must be an http(s) or ws(s) URL");
    }
    if (url.protocol === "https:") url.protocol = "wss:";
    else if (url.protocol === "http:") url.protocol = "ws:";
    else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      throw new Error("CMS address must be an http(s) or ws(s) URL");
    }
    return url.href;
  }

  function createPairingSession(options) {
    const emit = typeof options?.onEvent === "function" ? options.onEvent : function () {};
    const storage = options?.storage || root.localStorage;
    const onCommand = typeof options?.onCommand === "function" ? options.onCommand : null;
    const pingMs = Number(options?.pingIntervalMs) > 0 ? Number(options.pingIntervalMs) : 15000;
    const maxMissedPongs = 2;
    let socket = null;
    let cmsEndpoint = "";
    let code = "";
    let pingTimer = null;
    let awaitingPong = false;
    let missedPongs = 0;

    function readStored() {
      try {
        const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
        if (!parsed || typeof parsed !== "object") return null;
        return parsed;
      } catch {
        return null;
      }
    }

    function writeStored(value) {
      if (!value) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, JSON.stringify(value));
    }

    function hostInfo() {
      try {
        if (typeof root.TomorrowOSHost?.getInfo === "function") return root.TomorrowOSHost.getInfo() || {};
      } catch { /* the host reports its own failure */ }
      return {};
    }

    function deviceId() {
      const stored = readStored();
      const info = hostInfo();
      return info.serialNumber || info.deviceId || stored?.deviceId || null;
    }

    // CMS computes "device online" from this value and its own clock.
    // A bootedAt taken from the TV clock stays at 0s when the panel clock is ahead.
    function bootUptimeSec() {
      const reported = Number(hostInfo().uptimeSec);
      if (Number.isFinite(reported) && reported >= 0) return reported;
      const key = "tomorrowos.runtime.bootMs";
      let bootMs = NaN;
      try { bootMs = Number(root.sessionStorage?.getItem(key)); } catch { /* ignore */ }
      if (!Number.isFinite(bootMs) || bootMs <= 0) {
        bootMs = Date.now();
        try { root.sessionStorage?.setItem(key, String(bootMs)); } catch { /* ignore */ }
      }
      return Math.max(0, (Date.now() - bootMs) / 1000);
    }

    function handshake() {
      const config = root.TOMORROWOS_RUNTIME_CONFIG || {};
      const info = hostInfo();
      const uptimeSec = bootUptimeSec();
      return {
        platform: info.platform || "browser",
        playerVersion: config.runtimeVersion || "",
        deviceName: info.model || "Display",
        system: info.system || "Browser",
        serialNumber: deviceId(),
        bootUptimeSec: uptimeSec,
        bootedAt: new Date(Date.now() - uptimeSec * 1000).toISOString()
      };
    }

    function getState() {
      const stored = readStored();
      return {
        connected: !!(socket && socket.readyState === 1),
        cmsEndpoint,
        paired: !!(stored?.deviceId && stored?.pairingToken),
        deviceId: stored?.deviceId || deviceId(),
        code: code || ""
      };
    }

    function stopPing() {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      awaitingPong = false;
      missedPongs = 0;
    }

    function ping(current) {
      if (socket !== current || current.readyState !== 1) return;
      if (awaitingPong) {
        missedPongs += 1;
        if (missedPongs >= maxMissedPongs) {
          try { current.close(); } catch { /* onclose reports the drop */ }
          return;
        }
      }
      awaitingPong = true;
      send({ type: "device.ping", timestamp: new Date().toISOString() });
    }

    function send(payload) {
      if (!socket || socket.readyState !== 1) return;
      socket.send(JSON.stringify(payload));
    }

    function sendHelloOrResume() {
      const stored = readStored();
      const id = deviceId();
      if (stored?.deviceId && stored?.pairingToken) {
        send({
          type: "device.resume",
          deviceId: stored.deviceId,
          pairingToken: stored.pairingToken,
          ...handshake()
        });
        return;
      }
      code = "";
      send({ type: "device.hello", deviceId: id, ...handshake() });
    }

    function withoutToken(msg) {
      const copy = { ...msg };
      delete copy.pairingToken;
      return copy;
    }

    async function answerCommand(current, msg) {
      let result;
      try {
        if (!onCommand) throw new Error(`Unsupported command: ${msg.method || "unknown"}`);
        result = (await onCommand(msg)) || { status: "success" };
      } catch (err) {
        result = { status: "failed", error: err?.message || "Command failed" };
      }
      if (current.readyState === 1) {
        const reply = {
          type: "command.result",
          commandId: msg.commandId,
          method: msg.method,
          status: result.status || "success"
        };
        if (result.data !== undefined) reply.data = result.data;
        if (result.error) reply.error = String(result.error);
        try { current.send(JSON.stringify(reply)); } catch { /* socket closed mid-command */ }
      }
      if (typeof result.after === "function") {
        try { await result.after(); } catch { /* the command already answered */ }
      }
    }

    function handleMessage(raw, current) {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "device.pong") {
        awaitingPong = false;
        missedPongs = 0;
        return;
      }
      if (msg.type === "command") {
        void answerCommand(current, msg);
        return;
      }
      if (msg.type === "brand.snapshot") {
        if (msg.brand && typeof msg.brand === "object") emit({ type: "brand", brand: msg.brand });
        return;
      }

      if (msg.type === "pairing.code" && msg.method === "tomorrowos.pairing.createCode") {
        const stored = readStored();
        if (stored?.pairingToken) return;
        code = typeof msg.code === "string" ? msg.code : "";
        emit({ type: "code", code, message: msg });
        return;
      }
      if (msg.type === "pairing.verified" && msg.method === "tomorrowos.pairing.verify") {
        const pairedAt = new Date().toISOString();
        writeStored({
          deviceId: msg.deviceId || deviceId(),
          pairingToken: msg.pairingToken || "",
          pairedAt
        });
        code = "";
        emit({ type: "verified", deviceId: msg.deviceId || deviceId(), pairedAt, message: withoutToken(msg) });
        return;
      }
      if (msg.type === "device.resumed" && msg.method === "tomorrowos.pairing.resume") {
        code = "";
        emit({ type: "resumed", deviceId: readStored()?.deviceId || deviceId(), message: withoutToken(msg) });
        return;
      }
      if (msg.type === "device.resume.failed") {
        writeStored(null);
        code = "";
        emit({ type: "resumeFailed", message: msg });
        sendHelloOrResume();
        return;
      }
      if (msg.type === "pairing.unpaired" && msg.method === "tomorrowos.pairing.unpair") {
        writeStored(null);
        code = "";
        emit({ type: "unpaired", message: msg });
        sendHelloOrResume();
        return;
      }
      emit({ type: "message", message: msg });
    }

    function disconnect() {
      stopPing();
      const current = socket;
      socket = null;
      code = "";
      if (current && current.readyState !== 3) {
        try { current.close(); } catch { /* ignore */ }
      }
      if (current) emit({ type: "status", status: "closed", cmsEndpoint });
      return getState();
    }

    function connect(endpoint) {
      const url = normalizePairingEndpoint(endpoint);
      disconnect();
      cmsEndpoint = url;
      const WS = options?.WebSocket || root.WebSocket;
      if (typeof WS !== "function") throw new Error("WebSocket is not available");
      emit({ type: "status", status: "connecting", cmsEndpoint: url });
      return new Promise((resolve, reject) => {
        let settled = false;
        const current = new WS(url);
        socket = current;
        current.onopen = () => {
          sendHelloOrResume();
          stopPing();
          pingTimer = setInterval(() => ping(current), pingMs);
          if (!settled) {
            settled = true;
            resolve(getState());
          }
        };
        current.onmessage = (event) => handleMessage(event.data, current);
        current.onerror = () => {
          if (!settled) {
            settled = true;
            reject(new Error("CMS connection failed"));
          }
        };
        current.onclose = () => {
          if (socket === current) socket = null;
          stopPing();
          emit({ type: "status", status: "closed", cmsEndpoint: url });
          if (!settled) {
            settled = true;
            reject(new Error("CMS connection closed"));
          }
        };
      });
    }

    function sendMessage(message) {
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        throw new Error("CMS message must be an object");
      }
      if (message.type === "device.hello" || message.type === "device.resume") {
        throw new Error("Device identity messages are sent by the shell");
      }
      if (message.type === "command.result") {
        throw new Error("CMS commands are answered by the shell");
      }
      if (!socket || socket.readyState !== 1) throw new Error("CMS is not connected");
      socket.send(JSON.stringify(message));
      return { ok: true };
    }

    // A new CMS address starts a new pairing; the old token belongs to the old CMS.
    function forget() {
      writeStored(null);
      code = "";
      return getState();
    }

    return { connect, disconnect, forget, getState, send: sendMessage };
  }

  RT.normalizePairingEndpoint = normalizePairingEndpoint;
  RT.createPairingSession = createPairingSession;
})(typeof globalThis !== "undefined" ? globalThis : this);
