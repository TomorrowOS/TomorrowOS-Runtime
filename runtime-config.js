// Package-level shell settings. Option A leaves appSourceUrl empty so the
// operator chooses an application source on first launch. A later branded
// package (Option B) can set appSourceUrl and lockAppSource without changing
// the loader, manifest client, or update manager.
window.TOMORROWOS_RUNTIME_CONFIG = {
  shellName: "TomorrowOS",
  runtimeVersion: "1.2.2",
  appSourceUrl: "",
  lockAppSource: false
};
