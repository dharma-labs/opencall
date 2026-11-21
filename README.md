# OpenCall

**Communication without intermediaries.** OpenCall connects two devices directly
over WebRTC for messaging, voice, video and file transfer. There is no account,
no database and no server of yours to run. You press **New call**, send a link,
and the other device is in the call the moment it opens it.

The link is the whole ritual. A shared room code is relayed through a public MQTT
broker over WebSocket, which carries nothing but the code, a display name and the
SDP/ICE handshake; media, messages and files go point to point. Hole-punching
through public STUN is how a device in one city reaches a device in another; a
network that defeats it needs a TURN server of your own, added in Settings.
Nothing is stored or uploaded by anyone.

Manual pairing — one QR code each way, an invite link, copy/paste or a file — is
still there under **Connect by hand** for networks that block the broker.

---

## Run it

```bash
npm install
```

| Target | Command | Notes |
| --- | --- | --- |
| Web (development) | `npm run dev` | http://localhost:5173 |
| Web (production) | `npm run build` then `npm run preview` | `dist/` is a complete static site |
| Desktop (Electron) | `npm run desktop:dev` | needs `npm run dev` running in a second terminal |
| Desktop (Electron, packaged) | `npm run desktop:dist` | writes installers to `release/` |
| Desktop (Tauri) | `npm run desktop:tauri:dev` | Rust toolchain required |
| Desktop (Tauri, packaged) | `npm run desktop:tauri:build` | writes bundles to `src-tauri/target/release/bundle/` |
| Mobile (PWA) | `npm run build` then open the site over HTTPS | install from the browser |
| Mobile (Android/iOS) | `npm run mobile:sync` then `npx cap open android` | Android Studio / Xcode required |
| Android APK (CLI) | `npm run mobile:sync`, then `.\gradlew.bat assembleDebug` in `android/` | needs `JAVA_HOME` on **JDK 21** (Gradle 8.14 rejects JDK 25) and `ANDROID_HOME`; output `android/app/build/outputs/apk/debug/app-debug.apk` |

Checks:

```bash
npm run typecheck   # strict TypeScript, no emit
npm test            # unit tests (signalling, message protocol, encryption)
```

### Publishing the site

Invite links point at `https://dharma-labs.github.io/opencall/`, served by GitHub
Pages from the `gh-pages` branch. To publish a new build:

```bash
npm run build
# then commit dist/ (plus an empty .nojekyll) onto gh-pages
gh api -X POST repos/dharma-labs/opencall/pages/builds
```

`docs/pages-deploy-workflow.yml` automates the same thing through GitHub Actions.
Copy it to `.github/workflows/pages.yml` **from the GitHub web UI** — pushing a
workflow file needs a `workflow` scope on the token, which the CLI login here does
not have.

---

## Look and feel

The interface is deliberately quiet: short labels, a charcoal surface ramp, and no
decoration that does not carry meaning. Four ideas do the work.

- **Three sections, one axis.** **Chats**, **History** and **Settings** sit dead
  centre of the top bar on desktop; on a phone they drop to a bottom bar so the
  targets stay thumb-sized. Chats is a two-pane messenger — the conversation list
  on the left, the thread on the right — and every session starts there.
- **Familiar where it matters.** The conversation borrows the grammar everyone
  already knows from a phone chat — day dividers, bubbles that group into runs
  with a tail on the last one, a timestamp and delivery ticks inside the bubble,
  a composer pill with a round send button.
- **Skin, not wallpaper.** The palette switch on the right of the bar changes
  theme (Midnight, OLED, Daylight, Messenger, LetsFi, Galib), accent and the chat
  wallpaper. Every colour is a CSS variable, so a theme is one table in
  `src/styles/index.css` and no component carries a colour literal.
- **Honest about state.** Connection quality, the safety code, the encryption
  state and every failure reason are visible in the UI rather than hidden.

It launches on a short "OpenCall — by Dharmendra" screen that holds until the
webfonts have loaded, so the first thing drawn is never a half-styled layout.

Design tokens are adapted from two reference apps
([galib](https://dharma-labs.github.io/galib/) and
[crazyocr](https://crazyocr.vercel.app/)). Colours are RGB triplets in CSS
variables that `tailwind.config.js` exposes as `ink-*`, `accent`, `bubble` and the
status colours; the skin itself is written onto `<html>` by
`src/modules/platform/ThemeManager.ts`. No component contains a colour literal, so
the entire product restyles from two files.

---

## How to test a real connection

Two peers are required. They do **not** have to share a network — the two devices
can be in different cities on different carriers.

1. Open OpenCall on both devices.
2. On the first: **Chats → New call**. A link appears; tap **Share** or **Copy link**.
3. Send it however you like. On the second, opening it starts the handshake by
   itself — no scanning, no typing, no code to read.
4. If the second device is offline when the link is sent, it still joins: the room
   stays open until someone closes it.
5. When the session opens, **compare the 20-digit safety code** on both screens.
   If they match, no one has swapped either key.

Then try chat, a voice call, a video call, screen sharing and a file drop.

### What will and will not connect

Each device gathers candidates from several **public STUN servers** (Google,
Nextcloud, Twilio) so a direct path is found whenever one exists; if one server's
name fails to resolve, another answers. There is **no built-in TURN relay**: every
free public relay tested from this network is dead, and a dead relay in the list
slows or breaks a handshake that would otherwise connect. If you need to cross a
symmetric NAT, add your own coturn entry under **Settings → Connection → Custom
ICE servers** (`turn:host:443?transport=tcp|user|secret`) and it is used verbatim.

- **Works** on the same network, on a LAN or VPN, and across ordinary home and
  mobile NATs — including two cities on two carriers.
- **Fails** when both sides sit behind symmetric NAT and no TURN server is
  configured. That is the one case only your own relay can solve.
- **Signalling has to reach a broker.** If both networks block WebSocket/443, use
  **Connect by hand**, which needs no relay at all.

---

## Privacy model

- No account, no phone number, no email, no registration.
- No application server, database or message queue of yours.
- Signalling runs through a public MQTT broker: room code, display name, SDP and
  ICE only, and only until the peer connection exists. The invite room lives in
  the URL **fragment**, so the web host never sees it.
- Media and files never touch the broker. They use a direct WebRTC path, or a
  TURN relay only if you add one yourself in Settings.
- Message history lives in this browser's IndexedDB only, and only if the
  History setting is on.
- Transport is DTLS (data) and SRTP (media) from WebRTC. Application-layer
  encryption (ECDH P-256 → HKDF-SHA256 → AES-256-GCM) is on by default, so the
  relay cannot read a payload even when it carries the packets.
- OpenCall does **not** claim anonymity: anyone carrying the packets can see that
  a connection exists, though not what is said.

---

## How the app is packaged

One static build, four shells. No target adds a service or a dependency on a
network the app does not already use.

```
              ┌──────────────────────────────┐
              │  dist/  (static, no backend) │
              └───────────────┬──────────────┘
     ┌────────────┬───────────┴────────┬──────────────┐
  Browser       PWA             Electron / Tauri    Capacitor
 (dev server) (service worker)   (desktop windows)  (Android / iOS)
```

### Desktop — Electron

`electron/main.cjs` serves the built app over a privileged `opencall://` scheme
rather than `file://`. That is what makes the renderer a secure context, which is
in turn what makes `navigator.mediaDevices` — and therefore every call — work
inside a desktop window. The shell also:

- allows only the permissions the app genuinely needs (`media`, `display-capture`,
  clipboard, fullscreen, pointer lock) and denies the rest;
- applies a `default-src 'self'` Content-Security-Policy to every response;
- sends any external link to the system browser and never navigates itself;
- runs with `contextIsolation: true`, `sandbox: true` and no Node in the renderer.

Build output in `release/`:

- `OpenCall-Setup-<version>.exe` — NSIS installer (per-user, choosable location)
- `OpenCall-Portable-<version>.exe` — single-file portable build
- `win-unpacked/OpenCall.exe` — run straight from the folder

### Desktop — Tauri 2

`src-tauri/` is a thin Rust shell: one window, no commands, no plugins, no IPC
surface. The same `dist/` bundle is embedded, and the same CSP is enforced through
`tauri.conf.json`. Produces NSIS and MSI installers on Windows.

### Mobile — PWA

`public/manifest.webmanifest` + `public/sw.js` make the site installable and
usable offline. The service worker caches the app shell (network-first for
navigations, cache-first for immutable assets) and never touches cross-origin
requests. Installed, it launches in its own window, keeps its own camera and
microphone permissions, and exposes **New call** / **Join call** shortcuts that
open straight into a handshake (`?action=create`, `?action=join`).

### Mobile — Capacitor

`capacitor.config.ts` + `android/` wrap the same build as a native app. The
Android WebView is served from `https://localhost`, which is a secure context, so
camera and microphone work. `AndroidManifest.xml` declares camera, microphone and
foreground-service permissions and marks the hardware as optional, so the app
still installs on devices without a camera.

For iOS, add the following to `ios/App/App/Info.plist` before building:

```xml
<key>NSCameraUsageDescription</key>
<string>OpenCall uses the camera for video calls.</string>
<key>NSMicrophoneUsageDescription</key>
<string>OpenCall uses the microphone for voice and video calls.</string>
```

---

## Project layout

```
src/
  modules/
    connection/   link rooms over a public MQTT broker, trickle ICE, STUN,
                  and the manual SDP exchange (gzip+base64url, QR, invite links)
    messaging/    envelope, message union, sanitising
    calling/      transceivers, media capture, mute/flip, screen share
    files/        chunking, backpressure, SHA-256 verification
    security/     ECDH / HKDF / AES-GCM, safety code
    platform/     runtime detection, service worker, install prompt
    storage/      IndexedDB history, localStorage preferences
  contexts/       OpenCallContext — the single orchestrator
  components/     landing, connection, chat, calling, history, settings, diagnostics, common
electron/         Electron main + preload
src-tauri/        Tauri 2 shell
android/          Capacitor Android project
public/           manifest, service worker, icons
```

---

## Honest status

The web app, the PWA layer, the Electron desktop build and the packaging
configuration are built and checked. Live two-peer WebRTC behaviour — an actual
call, an actual file transfer — has to be confirmed on two devices, and is not
claimed as verified. See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for the
exact list of what was and was not exercised.
