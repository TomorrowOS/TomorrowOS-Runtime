(function (root) {
  const RT = root.TomorrowOSRuntime || (root.TomorrowOSRuntime = {});

  // App Source is which application to run. It is intentionally a different
  // localStorage key from the built-in player's CMS endpoint.
  const APP_SOURCE_KEY = "tomorrowos.appSource";
  const APP_CACHE_KEY = "tomorrowos.appCache";
  const OPEN_SETUP_KEY = "tomorrowos.openAppSourceSetup";

  function storage() {
    try {
      if (root.localStorage) return root.localStorage;
    } catch { /* private mode */ }
    return null;
  }

  function readJson(key, fallback) {
    const store = storage();
    if (!store) return fallback;
    try {
      const raw = store.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    const store = storage();
    if (!store) return false;
    try {
      store.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function emptySource() {
    return { decided: false, sourceUrl: "", locked: false };
  }

  function readAppSource() {
    const parsed = readJson(APP_SOURCE_KEY, null);
    if (!parsed) return emptySource();
    return {
      decided: parsed.decided === true,
      sourceUrl: typeof parsed.sourceUrl === "string" ? parsed.sourceUrl.trim() : "",
      locked: parsed.locked === true
    };
  }

  function writeAppSource(source) {
    const next = {
      decided: source?.decided === true,
      sourceUrl: typeof source?.sourceUrl === "string" ? source.sourceUrl.trim() : "",
      locked: source?.locked === true
    };
    writeJson(APP_SOURCE_KEY, next);
    return next;
  }

  function readAppCache() {
    const parsed = readJson(APP_CACHE_KEY, null);
    const bySource = parsed && parsed.bySource && typeof parsed.bySource === "object"
      ? parsed.bySource
      : {};
    return { bySource };
  }

  function writeAppCache(cache) {
    writeJson(APP_CACHE_KEY, {
      bySource: cache && cache.bySource ? cache.bySource : {}
    });
  }

  function readSourceSlot(sourceUrl) {
    const cache = readAppCache();
    const slot = cache.bySource[sourceUrl];
    if (!slot || typeof slot !== "object") return { active: null, previous: null };
    return {
      active: slot.active || null,
      previous: slot.previous || null
    };
  }

  // Point at the new install only after the caller has validated it.
  // The previous active record stays available for rollback.
  function commitInstalledApp(sourceUrl, record) {
    const cache = readAppCache();
    const slot = cache.bySource[sourceUrl] || { active: null, previous: null };
    let previous = slot.previous || null;
    let obsolete = null;
    if (slot.active && slot.active.version !== record.version) {
      obsolete = slot.previous || null;
      previous = slot.active;
    }
    cache.bySource[sourceUrl] = {
      active: record,
      previous
    };
    writeAppCache(cache);
    return obsolete;
  }

  function rollbackInstalledApp(sourceUrl) {
    const cache = readAppCache();
    const slot = cache.bySource[sourceUrl];
    if (!slot || !slot.previous) return null;
    const broken = slot.active || null;
    cache.bySource[sourceUrl] = {
      active: slot.previous,
      previous: null
    };
    writeAppCache(cache);
    return { active: slot.previous, broken };
  }

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function safeSegment(value, fallback) {
    const cleaned = String(value || "")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 80);
    return cleaned || fallback;
  }

  RT.APP_SOURCE_KEY = APP_SOURCE_KEY;
  RT.APP_CACHE_KEY = APP_CACHE_KEY;
  RT.OPEN_SETUP_KEY = OPEN_SETUP_KEY;
  RT.readAppSource = readAppSource;
  RT.writeAppSource = writeAppSource;
  RT.readSourceSlot = readSourceSlot;
  RT.commitInstalledApp = commitInstalledApp;
  RT.rollbackInstalledApp = rollbackInstalledApp;
  RT.hashString = hashString;
  RT.safeSegment = safeSegment;
})(typeof globalThis !== "undefined" ? globalThis : this);
