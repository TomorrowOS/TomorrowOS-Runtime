// Shell-owned CMS commands. Device commands are answered here; content
// commands are passed to the handlers the application registered through the SDK.
(function (root) {
  const RT = root.TomorrowOSRuntime || (root.TomorrowOSRuntime = {});

  const BEFORE_REBOOT = "beforeReboot";
  const BEFORE_REBOOT_TIMEOUT_MS = 1500;
  const REBOOT_DELAY_MS = 150;
  const GUEST_TIMEOUT_MS = 30000;
  const GUEST_TIMEOUTS = {
    "device.content.setPolicy": 55000,
    "device.content.refreshMenuzenDesign": 55000,
    "device.telemetry.captureScreen": 15000
  };

  function success(data) {
    return { status: "success", data };
  }

  function hostApi() {
    const host = root.TomorrowOSHost;
    if (!host) throw new Error("TomorrowOS host is not available");
    return host;
  }

  function createCmsCommandRouter(options) {
    const guest = options.guest;
    const deviceInfo = options.deviceInfo;
    const disconnect = options.disconnect || function () {};

    function askGuest(method, params) {
      return guest.ask(method, params || {}, GUEST_TIMEOUTS[method] || GUEST_TIMEOUT_MS);
    }

    function capabilities() {
      const caps = hostApi().getCapabilities();
      const supported = (value) => ({ supported: !!value });
      const result = {
        capabilities: {
          "device.info.get": supported(true),
          "device.info.getCapabilities": supported(true),
          "device.power.reboot": supported(caps.reboot),
          "device.telemetry.captureScreen": supported(caps.captureScreen || guest.has("device.telemetry.captureScreen")),
          "device.display.setOnOffTimer": supported(caps.panelMute),
          "device.content.setPolicy": supported(guest.has("device.content.setPolicy")),
          "device.content.clear": supported(guest.has("device.content.clear"))
        }
      };
      if (typeof guest.names === "function") {
        guest.names().forEach((name) => {
          if (name.startsWith("device.") && !result.capabilities[name]) {
            result.capabilities[name] = supported(true);
          }
        });
      }
      return result;
    }

    async function captureScreen() {
      try {
        return success({ screenshot: { ...(await hostApi().captureScreen()), source: "device" } });
      } catch (err) {
        if (!guest.has("device.telemetry.captureScreen")) throw err;
        return success({ screenshot: await askGuest("device.telemetry.captureScreen") });
      }
    }

    async function reboot() {
      if (!hostApi().getCapabilities().reboot) throw new Error("Reboot is not available on this device");
      if (guest.has(BEFORE_REBOOT)) {
        try {
          await guest.ask(BEFORE_REBOOT, {}, BEFORE_REBOOT_TIMEOUT_MS);
        } catch {
          // An application that fails or hangs must not block an operator reboot.
        }
      }
      return {
        status: "accepted",
        data: { message: "Reboot command accepted" },
        after() {
          disconnect();
          return new Promise((resolve) => setTimeout(resolve, REBOOT_DELAY_MS)).then(() => hostApi().reboot());
        }
      };
    }

    function setOnOffTimer(params) {
      const input = Object.prototype.hasOwnProperty.call(params, "onOffTimer") ? params.onOffTimer : params;
      const schedule = input && typeof input === "object" ? input : { clear: true };
      return success(hostApi().setPowerSchedule(schedule));
    }

    async function handle(msg) {
      const method = String(msg?.method || "");
      const params = msg?.params && typeof msg.params === "object" ? msg.params : {};
      try {
        if (method === "device.info.get") return success(deviceInfo());
        if (method === "device.info.getCapabilities") return success(capabilities());
        if (method === "device.telemetry.captureScreen") return await captureScreen();
        if (method === "device.power.reboot") return await reboot();
        if (method === "device.display.setOnOffTimer") return setOnOffTimer(params);
        if (guest.has(method)) return success(await askGuest(method, params));
        throw new Error(`Unsupported command: ${method || "unknown"}`);
      } catch (err) {
        return { status: "failed", error: err?.message || "Command failed" };
      }
    }

    return { handle, capabilities };
  }

  RT.createCmsCommandRouter = createCmsCommandRouter;
})(typeof globalThis !== "undefined" ? globalThis : this);
