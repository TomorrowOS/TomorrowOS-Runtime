# TomorrowOS Application Runtime

**The open-source application foundation for digital signage hardware.**

TomorrowOS Application Runtime is a developing application shell and HTML5 SDK designed to make it easier to build, deploy and maintain digital signage applications across different hardware platforms.

Instead of building and maintaining a separate application for every manufacturer or operating system, developers can target common TomorrowOS interfaces while platform-specific integrations handle supported hardware capabilities.

Build your own CMS, digital menu board, dashboard, wayfinding application or entirely custom signage experience — without rebuilding the underlying device integration layer from scratch.

> **Project status: Developer Preview**
>
> The Application Runtime is under active development. Application loading, manifest handling, updates and the HTML5 API are implemented in this repository. This repository does not run on its own. A platform host loads it. Current hosts are Windows 11 Pro x64, and Samsung Tizen 6.5 and 7.0. APIs and packaging may change, and production compatibility must be verified for each hardware model and firmware.

[TomorrowOS](https://github.com/TomorrowOS/TomorrowOS) · [Documentation](https://docs.tomorrowos.org) · [Server SDK](https://github.com/TomorrowOS/TomorrowOS_SDK) · [Community](https://github.com/TomorrowOS/TomorrowOS/discussions)

---

## Why TomorrowOS Runtime?

Digital signage developers repeatedly face the same challenges:

- Different operating systems and hardware APIs
- Manufacturer-specific integrations
- Application installation and updates
- Local storage and offline operation
- Reliable media playback
- Device control and monitoring
- CMS communication and pairing
- Recovery when applications or networks fail

TomorrowOS aims to provide a common foundation for these capabilities.

Developers remain responsible for their applications, user interfaces, business logic and customer experiences.

**You build the application. TomorrowOS provides the underlying runtime interfaces.**

---

## Architecture

```text
┌──────────────────────────────────────────┐
│        Your Signage Application          │
│                                          │
│  CMS Player · Menu Boards · Dashboards   │
│  Wayfinding · Retail · Custom Apps       │
└────────────────────┬─────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────┐
│          TomorrowOS HTML5 SDK            │
│                                          │
│  Device · Playback · Files · CMS · Input  │
└────────────────────┬─────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────┐
│       TomorrowOS Application Shell       │
│                                          │
│  App Loading · Updates · Cache · Recovery│
│  Manifest · Command Routing · Pairing    │
└────────────────────┬─────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────┐
│       Platform-Specific Host Layer       │
│                                          │
│  Native APIs · Hardware · Storage        │
└────────────────────┬─────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────┐
│           Device Hardware                │
│                                          │
│ Samsung · BrightSign · Windows · Others  │
└──────────────────────────────────────────┘
```

The architecture is designed to make application development more consistent across platforms.

Actual compatibility depends on the available host implementation, operating system, hardware model and firmware.

---

## Core Components

| Component | Description |
|---|---|
| Application Shell | Hosts and manages built-in or external applications |
| Application Manifest | Defines an application's identity, version, package and entry point |
| HTML5 SDK | Provides a JavaScript interface for applications |
| Platform Bridge | Routes supported commands to the device host |
| Application Updates | Checks versions and manages application package updates |
| Local Application Cache | Reuses installed application packages when available |
| Recovery | Supports fallback to previous application versions or built-in experiences |
| CMS Integration | Provides pairing, communication and command routing |
| Capability Discovery | Allows applications to query supported host features |

### Repository Structure

```text
TomorrowOS-Runtime/
│
├── index.html
├── manifest.json
├── runtime-config.js
├── package.json
│
├── runtime/
│   ├── bootstrap.js
│   ├── manifest.js
│   ├── update-manager.js
│   ├── state.js
│   ├── platform-bridge.js
│   ├── pairing-session.js
│   ├── cms-commands.js
│   ├── source-setup.js
│   ├── version.js
│   ├── zip-extract.js
│   └── shell.css
│
└── sdk/
    └── tomorrowos.js
```

This repository is the shared application shell. It is not a standalone player, and opening `index.html` in a browser does not start a device.

A platform host loads this shell after installing `TomorrowOSHost`. The host also supplies device APIs and the built-in application. `package.json` does not define build or start scripts.

**Current hosts:**

| Host | Supported versions |
|---|---|
| Windows | Windows 11 Pro x64 |
| Samsung Tizen | 6.5 and 7.0 |

Device testing needs the matching host build together with this runtime.

---

## Quickstart: Create Your First Application

This example demonstrates the application format and HTML5 API currently defined by the Runtime.

A compatible TomorrowOS host build is required to run it on a device.

### 1. Create Your Application

Create a folder:

```text
hello-signage/
├── index.html
└── tomorrowos.js
```

Copy `sdk/tomorrowos.js` from this repository into your application folder.

Create `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hello TomorrowOS</title>

  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      background: #111827;
      color: white;
      font-family: Arial, sans-serif;
    }

    .container {
      text-align: center;
      padding: 40px;
    }

    pre {
      text-align: left;
      white-space: pre-wrap;
    }
  </style>
</head>

<body>
  <div class="container">
    <h1>Hello TomorrowOS</h1>
    <p id="status">Connecting to runtime...</p>
    <pre id="deviceInfo"></pre>
  </div>

  <script src="./tomorrowos.js"></script>

  <script>
    async function initialise() {
      const status = document.getElementById("status");
      const output = document.getElementById("deviceInfo");

      try {
        await TomorrowOS.ready();

        const info = await TomorrowOS.getInfo();
        const capabilities = await TomorrowOS.getCapabilities();

        status.textContent = "Connected to TomorrowOS";

        output.textContent = JSON.stringify({
          info,
          capabilities
        }, null, 2);

      } catch (error) {
        status.textContent = "Runtime unavailable";
        output.textContent = error.message;
      }
    }

    initialise();
  </script>
</body>
</html>
```

The HTML5 SDK communicates with its parent TomorrowOS Application Shell.

Opening the HTML file directly in a browser will not provide device APIs.

### 2. Package Your Application

Create a ZIP package containing the application files.

The ZIP root should contain:

```text
index.html
tomorrowos.js
```

For example, from inside the application directory:

```bash
zip -r ../hello-signage.zip index.html tomorrowos.js
```

Do not place the files inside an additional parent folder unless the manifest entry path accounts for that structure.

### 3. Create Your Application Manifest

Create a file named `manifest.json`:

```json
{
  "appId": "hello-signage",
  "version": "1.0.0",
  "packageUrl": "./hello-signage.zip",
  "entry": "index.html"
}
```

#### Manifest Fields

| Field | Required | Description |
|---|---|---|
| `appId` | Yes | Unique application identifier |
| `version` | Yes | Application version |
| `packageUrl` | Yes | HTTP(S) URL to a ZIP or WGT package |
| `entry` | No | Application HTML entry point, defaults to `index.html` |

The current manifest parser requires:

- `appId` to start with a letter or digit and contain only letters, digits, dots, underscores or hyphens, up to 64 characters
- `version` to be a nonempty string of up to 64 characters without whitespace or slashes
- `packageUrl` to resolve to an HTTP(S) URL ending in `.zip` or `.wgt`
- `entry` to be a relative `.html` or `.htm` path without directory traversal

The repository's own runtime manifest also contains `name` and `hostApi`, but these are not currently enforced as external application manifest compatibility fields.

### 4. Host Your Application

Upload the manifest and ZIP package to an accessible HTTPS server.

Example:

```text
https://example.com/hello-signage/
├── manifest.json
└── hello-signage.zip
```

The Application Shell can accept either:

```text
https://example.com/hello-signage/
```

Or:

```text
https://example.com/hello-signage/manifest.json
```

When a directory URL is supplied, the Runtime resolves `manifest.json` within it.

### 5. Load Your Application

On a compatible TomorrowOS Application Shell:

1. Open the application source setup screen.
2. Enter your application manifest URL.
3. Select **Save application source**.
4. The Shell retrieves and validates the manifest.
5. The host downloads and installs the application package.
6. The Shell loads the application's entry point.
7. The application communicates through the TomorrowOS HTML5 SDK.

The application source and CMS endpoint are separate concepts.

The application source determines which application runs on the device.

The CMS endpoint determines which CMS that application connects to.

---

## Configure the Application Shell

The Shell supports a predefined application source using `runtime-config.js`.

Example:

```javascript
window.TOMORROWOS_RUNTIME_CONFIG = {
  shellName: "TomorrowOS",
  runtimeVersion: "1.2.4",
  appSourceUrl: "https://example.com/hello-signage/manifest.json",
  lockAppSource: false
};
```

### Configuration Options

| Option | Description |
|---|---|
| `shellName` | Name displayed by the Shell |
| `runtimeVersion` | Shell version identifier |
| `appSourceUrl` | Optional predefined application source |
| `lockAppSource` | Restricts changing the predefined source through the normal setup interface |
When no application source is configured, the Shell can present an application selection/setup experience.

Where a compatible built-in application is available, the operator may also select it.

`lockAppSource` controls application source selection behaviour. It should not be treated as a security mechanism.

---

## TomorrowOS HTML5 SDK

Applications use the JavaScript SDK located at:

```text
sdk/tomorrowos.js
```

The SDK exposes:

```javascript
window.TomorrowOS
```

The inspected SDK currently identifies itself as:

```javascript
TomorrowOS.apiVersion // "7"
```

### Connecting to the Shell

The Shell loads the application with a one-time `tomorrowos_nonce` query parameter. The SDK presents that nonce and receives a private `MessageChannel` port; all later messages use the port. The Shell accepts nothing else from the application frame.

- SDK API version 7 and Runtime 1.2.4 or newer must be used together. Applications built with SDK API version 6 or earlier (which used `window.postMessage`) can no longer connect, and an SDK 7 application cannot connect to a Shell older than 1.2.4. The Shell logs a console error when an application has not connected five seconds after loading.
- Applications with several HTML pages should open them with `TomorrowOS.navigate(url)`. Ordinary `<a href>` links to pages in the application folder also work, because the SDK carries the nonce. A page opened without the nonce (for example through `location.href` or a form submit) is not connected, and its SDK calls fail at once with an explanatory error. Single-page applications and in-page routing need no change.
- `TomorrowOS.getTransport()` returns `"channel"`, `"pending"`, `"unconnected"`, `"failed"` or `"none"` for diagnostics.

The following API methods are present in the developer-preview source.

### Device Information

```javascript
const info = await TomorrowOS.getInfo();
```

Provides device information made available by the host.

Depending on the implementation, this may include:

- Device identifier
- Platform
- Model
- Firmware
- Serial number
- Uptime
- Online state

Returned values depend on the host and hardware.

### Capability Discovery

```javascript
const capabilities = await TomorrowOS.getCapabilities();

console.log(capabilities);
```

Applications should check capabilities before relying on device-specific functions.

For example:

```javascript
const capabilities = await TomorrowOS.getCapabilities();

if (capabilities.reboot === true) {
  console.log("Reboot is available");
}
```

The HTML5 SDK returns the host capability representation.

This is distinct from the CMS command `device.info.getCapabilities`, which reports a map of device commands using `supported` properties.

### Playback API

The HTML5 SDK exposes:

```javascript
TomorrowOS.play(url, seekMs, options)
TomorrowOS.stop()
TomorrowOS.getPlaybackState()
TomorrowOS.onPlaybackEvent(listener)
```

Example:

```javascript
const capabilities = await TomorrowOS.getCapabilities();

console.log("Host capabilities:", capabilities);

// Use the target host's supported media formats and playback rules.

await TomorrowOS.play(
  "https://example.com/video.mp4"
);
```

Applications can subscribe to playback events:

```javascript
const unsubscribe = TomorrowOS.onPlaybackEvent((event) => {
  console.log("Playback event:", event);
});
```

Playback support, codecs, rendering behaviour and hardware acceleration depend on the host implementation.

### Device Controls

The SDK exposes:

```javascript
TomorrowOS.reboot()
TomorrowOS.captureScreen()
TomorrowOS.setPanelMute(muted)
TomorrowOS.setPowerSchedule(schedule)
```

Example:

```javascript
const capabilities = await TomorrowOS.getCapabilities();

if (capabilities.reboot === true) {
  await TomorrowOS.reboot();
}
```

Device controls are not guaranteed across all hardware.

Always check capability availability and handle rejected calls.

### File and Storage API

The SDK exposes:

```javascript
TomorrowOS.downloadFile(url, options)
TomorrowOS.cancelDownload()
TomorrowOS.onDownloadProgress(listener)

TomorrowOS.readFile(path)
TomorrowOS.writeFile(path, text)
TomorrowOS.removeFile(path)
TomorrowOS.fileExists(path)

TomorrowOS.extractArchive(path, options)
```

Example download:

```javascript
const unsubscribe = TomorrowOS.onDownloadProgress((progress) => {
  console.log("Download progress:", progress);
});

await TomorrowOS.downloadFile(
  "https://example.com/content/video.mp4"
);
```

Storage paths, permissions, quotas and file capabilities depend on the host.

Applications should not assume unrestricted access to the device filesystem.

### Display and Input API

The SDK exposes:

```javascript
TomorrowOS.getOrientation()
TomorrowOS.onRemoteKey(listener)
```

Example:

```javascript
const orientation = await TomorrowOS.getOrientation();

console.log("Display orientation:", orientation);
```

Remote input:

```javascript
const unsubscribe = TomorrowOS.onRemoteKey((event) => {
  console.log("Input received:", event);
});
```

Input availability depends on the platform and connected hardware.

---

## CMS Integration

TomorrowOS separates the application experience from the CMS implementation.

Developers can create their own CMS using the TomorrowOS Server SDK or implement their own compatible application logic.

The Application Runtime includes pairing and CMS communication interfaces.

### Connect to a CMS

```javascript
await TomorrowOS.connectCms(
  "https://your-cms.example.com"
);
```

### Query Pairing State

```javascript
const state = await TomorrowOS.getPairingState();

console.log(state);
```

### Additional CMS Methods

```javascript
TomorrowOS.disconnectCms()
TomorrowOS.forgetCmsPairing()
TomorrowOS.sendCmsMessage(message)
TomorrowOS.onPairingEvent(listener)
```

### Handle Content Policies

An application can register a handler for CMS content policy commands.

```javascript
TomorrowOS.onContentPolicy(async (params) => {
  const policy = params.policy || {};

  console.log("Content policy received:", policy);

  // Validate and implement your application's content handling.

  return {
    applied: true
  };
});
```

Handle content clearing:

```javascript
TomorrowOS.onContentClear(async () => {
  // Stop playback and clear application content as appropriate.

  return {
    cleared: true
  };
});
```

Register additional application commands:

```javascript
TomorrowOS.onCommand("device.custom.refresh", async (params) => {
  // Implement your application-specific command.

  return {
    refreshed: true
  };
});
```

The Shell routes registered commands to the application.

**Important:** Applications remain responsible for implementing their content rendering and business logic. A successful command response does not automatically prove that content was displayed on the physical screen.

---

## Application Lifecycle

The Runtime implements an application lifecycle intended for unattended signage environments.

### Application Installation

The Shell:

1. Reads the configured application source.
2. Retrieves the application manifest.
3. Checks the application version.
4. Requests installation through the platform host.
5. Validates the installed entry point.
6. Starts the application inside the Shell.

### Application Updates

When a newer version becomes available, the Runtime can request installation of the updated package.

Version comparison supports numeric `major.minor.patch` versions.

For nonnumeric version identifiers, a changed version string is treated as an update.

To publish an application update:

1. Build a new application package.
2. Upload the package.
3. Update the manifest `version`.
4. Ensure the package URL is accessible.
5. Validate deployment on the target host.

Do not rely on replacing package contents without changing the manifest version.

### Offline Startup

Where a valid application has already been installed, the Runtime can reuse the locally cached application when a manifest request fails.

This allows the Shell to attempt startup without requiring an immediate successful network request.

The application itself is responsible for handling any CMS connectivity, content caching and offline business logic it requires.

### Recovery and Rollback

The Runtime contains logic to retain an earlier installed application record.

When an update fails, the Shell can attempt to use an existing installed version.

If a newly updated application fails during entry-point loading, the Runtime can attempt to restore the previous installed application.

Where recovery is unsuccessful, a compatible host build may provide a built-in fallback application.

These recovery mechanisms are implementation features, not guarantees against every application crash, power failure or corrupted deployment.

All recovery paths require testing on the target hardware.

---

## Applications vs Widgets

TomorrowOS supports different approaches to building signage experiences.

### Applications

Applications are complete experiences loaded by the TomorrowOS Application Shell.

They can implement:

- Full-screen signage applications
- Custom CMS players
- Digital menu board applications
- Interactive experiences
- Wayfinding systems
- Dashboards
- Retail experiences
- Bespoke industry applications

Applications use the Application Runtime's manifest-based packaging and HTML5 SDK.

### Widgets

Widgets are content items used within the existing TomorrowOS Player playlist system.

Examples include:

- Clocks
- Data panels
- Information displays
- Queue displays
- HTML animations
- Custom content components

Widgets are managed through playlist content policies rather than the Application Runtime's full-application lifecycle.

| Feature | Applications | Widgets |
|---|---|---|
| Purpose | Complete application | Content within a playlist |
| Lifecycle | Application Shell | Playlist Player |
| Packaging | Manifest-driven application | Hosted HTML or widget archive |
| Updates | Application version management | Playlist/content management |
| APIs | HTML5 Runtime SDK | Existing player/widget behaviour |
| Typical use | Custom signage platform | Embedded dynamic content |

See the [Widget and ZIP Package Guide](https://github.com/TomorrowOS/TomorrowOS/blob/main/docs/guides/widget-zip-packages.md).

---

## Platform Compatibility

TomorrowOS aims to provide a common developer experience across digital signage platforms.

The Application Runtime runs inside a platform host. It is currently loaded by these hosts:

| Host | Supported versions |
|---|---|
| Windows | Windows 11 Pro x64 |
| Samsung Tizen | 6.5 and 7.0 |

The broader TomorrowOS project documents existing player support separately:

| Platform | Existing TomorrowOS Player | Application Runtime |
|---|---|---|
| Samsung Tizen 6.5 and 7.0 | Supported | Supported through the Tizen host |
| Windows 11 Pro x64 | Supported | Supported through the Windows host |
| BrightSign Series 3–6 | Supported | Host integration and validation required |
| Android / NovaStar | In development | Not production certified |
| LG webOS | Planned | Not production certified |

**Existing player support does not automatically mean Application Runtime support.** BrightSign, Android, and webOS are not current Application Runtime hosts.

Runtime compatibility must be validated for the specific platform, model, firmware, host build and required capabilities.

See the [TomorrowOS Platform Compatibility Matrix](https://github.com/TomorrowOS/TomorrowOS/blob/main/docs/data/platform-compatibility.json).

---

## Security Considerations

TomorrowOS Runtime is currently a developer preview.

Third-party application hosting introduces important security considerations.

These include:

- Application source trust
- Manifest validation
- Package authenticity and integrity
- Safe ZIP extraction
- Filesystem access boundaries
- Device API permissions
- CMS authentication
- Application-to-Shell communication
- Message origin verification
- Application update and rollback behaviour

Application-to-Shell communication uses a private `MessageChannel` that is handed over only to the page that presents the launch's one-time nonce (see [Connecting to the Shell](#connecting-to-the-shell)). When the application is served from an `http(s)` address, the Shell and SDK additionally check and name the peer's origin. Applications served from `file://` have no origin that can be named, so the nonce and the private channel are what protect the connection there.

The earlier `window.postMessage` request path, which trusted the application frame as a whole, has been removed. The nonce is visible to the application's own code, so it does not protect against a malicious application itself. The application trust boundary, per-application permissions, package authenticity and exposed host operations still require further review before running untrusted third-party applications.

The current manifest contract does not require a package checksum or digital signature.

**Do not assume arbitrary third-party applications are safe to run without appropriate validation and deployment controls.**

Never include private signing keys, credentials, production secrets or confidential customer information in public repositories or application bundles.

Security issues should be reported through the [TomorrowOS Security Policy](https://github.com/TomorrowOS/TomorrowOS/blob/main/SECURITY.md).

---

## Current Limitations

The following limitations apply to the inspected developer-preview source:

- This repository does not run on its own. Current hosts are Windows 11 Pro x64, and Samsung Tizen 6.5 and 7.0.
- Opening `index.html` in a browser does not provide device APIs or start an application.
- Platform hosts and their built-in applications are separate from this repository.
- Application Runtime APIs may change.
- Device capabilities vary by host and firmware.
- Third-party application security requires additional validation.
- Automatic recovery does not cover every application failure.
- Universal cross-platform application compatibility has not been established.
- A public application marketplace is not currently included.
- Hardware-specific certification is required before production support claims.

We aim to document limitations openly as the Runtime develops.

---

## What Can You Build?

The Application Runtime is intended to support a broad range of digital signage products.

| Use Case | Example |
|---|---|
| Digital signage CMS | Build your own branded platform |
| Digital menu boards | Restaurant menus, pricing and promotions |
| Interactive kiosks | Customer-facing information and workflows |
| Wayfinding | Building and venue directories |
| Corporate communications | Internal dashboards and messaging |
| Retail | Promotions and product experiences |
| Hospitality | Guest information and service displays |
| Data visualisation | API-driven operational dashboards |
| Custom signage | Industry-specific applications |

TomorrowOS does not dictate how your application looks, which CMS you use or what commercial model you adopt.

Your application and customer experience remain yours.

---

## Developer Resources

| Resource | Link |
|---|---|
| TomorrowOS Main Project | [GitHub](https://github.com/TomorrowOS/TomorrowOS) |
| Server SDK | [TomorrowOS SDK](https://github.com/TomorrowOS/TomorrowOS_SDK) |
| Documentation | [docs.tomorrowos.org](https://docs.tomorrowos.org) |
| Website | [tomorrowos.org](https://tomorrowos.org) |
| Discussions | [Community](https://github.com/TomorrowOS/TomorrowOS/discussions) |
| Issues | [Report an Issue](https://github.com/TomorrowOS/TomorrowOS-Runtime/issues) |
| Hardware Compatibility | [Compatibility Matrix](https://github.com/TomorrowOS/TomorrowOS/blob/main/docs/data/platform-compatibility.json) |

---

## Contributing

TomorrowOS is being developed as an open-source foundation for the digital signage industry.

We welcome constructive contributions from:

- Software developers
- CMS providers
- Digital signage integrators
- Hardware manufacturers
- Independent application developers
- Technical documentation contributors

Useful contributions include:

- Runtime improvements
- Hardware integration testing
- Application examples
- API documentation
- Bug reports
- Compatibility results
- Security improvements
- Developer tooling

Before submitting substantial architectural changes, please start a discussion with the maintainers.

When reporting bugs, include:

1. Device manufacturer and model
2. Operating system and firmware
3. Application Runtime and host version
4. Application manifest version
5. Steps to reproduce
6. Expected behaviour
7. Actual behaviour
8. Relevant logs, with sensitive data removed

[Join the TomorrowOS Discussions](https://github.com/TomorrowOS/TomorrowOS/discussions)

---

## Roadmap

Development priorities include:

### Current Development

- Application Shell improvements
- HTML5 SDK refinement
- Application manifest and lifecycle development
- Platform bridge improvements
- Update and recovery testing
- Host integration validation

### Future Development

- Broader platform compatibility
- Additional hardware certification
- Developer application examples
- Improved application packaging and validation
- Enhanced developer tooling
- Expanded API documentation
- Further security hardening

Features and timelines may change as development and hardware testing progress.

See the [TomorrowOS Roadmap](https://github.com/TomorrowOS/TomorrowOS/blob/main/ROADMAP.md).

---

## Licensing

The broader TomorrowOS project is released under the Apache License 2.0.

However, this Runtime repository must include its own applicable licence or an explicit licensing statement before third-party redistribution rights can be assumed.

The maintainers should confirm and publish the intended licence and any required notices.

See the [main TomorrowOS repository](https://github.com/TomorrowOS/TomorrowOS) for the broader project's licensing information.

---

## Our Vision

TomorrowOS is being built to make digital signage development more open, accessible and hardware-independent.

We believe developers should be able to create applications without rebuilding fundamental device integrations for every screen manufacturer.

A common application foundation can help CMS providers, hardware manufacturers and independent developers create better signage experiences while retaining ownership of the products they build.

**Build your application. Reach more screens. Help shape the future of digital signage.**

[Get Started](https://docs.tomorrowos.org) · [Explore TomorrowOS](https://tomorrowos.org) · [Join the Community](https://github.com/TomorrowOS/TomorrowOS/discussions)
