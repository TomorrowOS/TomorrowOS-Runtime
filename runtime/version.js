(function (root) {
  const RT = root.TomorrowOSRuntime || (root.TomorrowOSRuntime = {});

  function parseSemver(value) {
    const match = String(value || "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }

  // "Newer" means a different published version. Numeric semver can refuse a
  // downgrade. Any other version string treats a difference as a publish,
  // because developers are free to use their own version labels.
  function isNewerVersion(remoteVersion, localVersion) {
    const remote = String(remoteVersion || "").trim();
    const local = String(localVersion || "").trim();
    if (!remote) return false;
    if (!local) return true;
    if (remote === local) return false;

    const remoteSemver = parseSemver(remote);
    const localSemver = parseSemver(local);
    if (remoteSemver && localSemver) {
      for (let i = 0; i < 3; i += 1) {
        if (remoteSemver[i] !== localSemver[i]) return remoteSemver[i] > localSemver[i];
      }
      return false;
    }

    return true;
  }

  RT.parseSemver = parseSemver;
  RT.isNewerVersion = isNewerVersion;
})(typeof globalThis !== "undefined" ? globalThis : this);
