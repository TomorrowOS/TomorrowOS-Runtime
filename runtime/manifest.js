(function (root) {
  const RT = root.TomorrowOSRuntime || (root.TomorrowOSRuntime = {});

  function isSafeRelativeEntry(entry) {
    if (typeof entry !== "string") return false;
    const value = entry.trim();
    if (!value || value.length > 240) return false;
    if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || value.includes("\0")) {
      return false;
    }
    if (!/\.html?$/i.test(value)) return false;
    const parts = value.split("/");
    return parts.every((part) => part && part !== "." && part !== "..");
  }

  function isHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  function normalizeManifest(data, manifestUrl) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Application manifest must be a JSON object");
    }

    const appId = String(data.appId || "").trim();
    const version = String(data.version || "").trim();
    const entry = String(data.entry || "index.html").trim();
    const packageValue = String(data.packageUrl || "").trim();

    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(appId)) {
      throw new Error("Manifest appId is missing or invalid");
    }
    if (!version || version.length > 64 || /[\\/\s]/.test(version)) {
      throw new Error("Manifest version is missing or invalid");
    }
    if (!isSafeRelativeEntry(entry)) {
      throw new Error("Manifest entry must be a relative HTML path");
    }
    if (!packageValue) throw new Error("Manifest packageUrl is missing");

    let packageUrl;
    try {
      packageUrl = new URL(packageValue, manifestUrl).href;
    } catch {
      throw new Error("Manifest packageUrl is not a valid URL");
    }
    if (!isHttpUrl(packageUrl)) {
      throw new Error("Manifest packageUrl must be an http(s) URL");
    }
    if (!/\.(zip|wgt)(\?|#|$)/i.test(packageUrl)) {
      throw new Error("Manifest packageUrl must point to a .zip or .wgt package");
    }

    return {
      appId,
      version,
      packageUrl,
      entry,
      manifestUrl: String(manifestUrl || "")
    };
  }

  // A directory address such as https://host/demo-app means manifest.json in that directory.
  function resolveManifestUrl(raw) {
    const value = String(raw || "").trim();
    if (!value) return null;
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (/\.json$/i.test(url.pathname)) return url.href;
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return new URL("manifest.json", url).href;
  }

  function normalizeSourceUrl(raw) {
    return resolveManifestUrl(raw);
  }

  // Tizen keeps a cached copy of a URL that has no Cache-Control header.
  // A new query value forces the device to read the current file.
  function uncachedUrl(url, token) {
    const next = new URL(url);
    next.searchParams.set("tomorrowos", String(token || Date.now()));
    return next.href;
  }

  async function fetchManifest(sourceUrl, options = {}) {
    const manifestUrl = resolveManifestUrl(sourceUrl);
    if (!manifestUrl) throw new Error("Application source must be an http(s) URL");
    const requestUrl = uncachedUrl(manifestUrl);
    const fetchImpl = options.fetchImpl || root.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("Fetch is not available");
    }
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 12000;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => {
      try { controller?.abort(); } catch { /* ignore */ }
    }, timeoutMs);

    try {
      const response = await fetchImpl(requestUrl, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache"
        },
        signal: controller ? controller.signal : undefined
      });
      if (!response || !response.ok) {
        throw new Error(`Manifest request failed (${response ? response.status : "no response"})`);
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("Manifest response was not valid JSON");
      }
      return normalizeManifest(data, manifestUrl);
    } catch (err) {
      if (err && (err.name === "AbortError" || /abort/i.test(String(err.message || "")))) {
        throw new Error("Manifest request timed out");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  RT.isSafeRelativeEntry = isSafeRelativeEntry;
  RT.normalizeManifest = normalizeManifest;
  RT.normalizeSourceUrl = normalizeSourceUrl;
  RT.uncachedUrl = uncachedUrl;
  RT.fetchManifest = fetchManifest;
})(typeof globalThis !== "undefined" ? globalThis : this);
