# OpenCall — Development Status

Last updated: 2026-11-22

OpenCall is a peer-to-peer messaging, voice, video and file-transfer app. There is
**no backend, no account, no database, no cloud storage and no registration**.
Connecting is one step: press **New call**, send the link, and the other device is
in the handshake the moment it opens it. The link carries a room code in the URL
fragment and the handshake runs through a **public MQTT broker over WebSocket**
(`src/modules/connection/SignalBus.ts`), which relays nothing but the room code, a
display name and SDP/ICE until the peer connection exists. Media, messages and
files are point to point, and application-layer AES-256-GCM is on by default, so
the broker cannot read a payload even on a relayed path.

Hole-punching through **several public STUN servers** is the only built-in path.
There is **no free TURN relay any more**: every public relay probed from this
network is dead (`turn.manual.to` refuses the connection, OpenRelay allocates
nothing), and leaving a dead relay in `iceServers` reproducibly stalled a pairing
that connected in seconds without it. A user who needs to cross a symmetric NAT
adds their own coturn entry under Settings → Connection, which is used verbatim.

Manual pairing — **one QR code each way**, a `#oc=` invite link, copy/paste or a
JSON file — is kept as the fallback for networks that block the broker, and needs
no relay of any kind.

---

## 1. Build & verification status

| Check | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` (`tsc --noEmit`, strict) | **Pass** |
| Unit tests | `npm test` (`vitest run`) | **Pass — 23/23 tests across 5 files** (signalling, message protocol, encryption, link handshake, broker election) |
| One-QR handshake | `npx vitest run src/modules/connection/SignalingManager.test.ts` | **Pass — 7/7.** A realistic 3086-character Chrome offer (audio + video + 2 data channels, host/srflx/IPv6/TCP candidates) packs to **1368 characters** (< `DEFAULT_QR_CHARS` 1800), so `splitForQr()` returns **1** part and the whole offer fits a single QR code. The round trip decodes back to the identical SDP. |
| Production build | `npm run build` (`tsc --noEmit && vite build`) | **Pass — 137 modules, `dist/index.html` 1.52 kB, CSS 50.07 kB (gzip 8.90 kB), JS 769.92 kB (gzip 247.28 kB). The size rise is mqtt.js, which the link handshake needs.** |
| Dev server | `npm run dev` | **Pass — serves on http://localhost:5173, `/` and `/src/main.tsx` return HTTP 200 with no transform errors** |
| Link handshake, live | Two peers in the same browser (top window + same-origin iframe) on `npm run preview` | **Pass — "New call" produced `…/#r=<code>`, the second peer opened it, both sides published retained presence on `oc/v1/<room>/p/<id>`, one side offered, the other answered, trickle ICE crossed, the data channel opened and both reached `connected · direct line`. Two chat messages sent in each direction arrived and rendered with delivery ticks.** |
| Broker reachability | Node client against `wss://broker.emqx.io:8084/mqtt` | **Pass — anonymous connect, retained presence seen from the browser, offer received by the Node client, answer accepted by `setRemoteDescription`, ICE candidates (host + srflx) streamed.** |
| Link handshake, live from the deployed site | Two peers in one browser (top window + same-origin iframe) on `https://dharma-labs.github.io/opencall/` | **Pass with the relay off — "New call" produced `https://dharma-labs.github.io/opencall/#r=<code>&n=Guest`, the second peer opened it, presence paired over the public broker and both sides reached `connected · direct line` within ~12 s.** |
| ICE server reachability | `ice-probe.html` on the deployed site — one `RTCPeerConnection` per server, candidates and `onicecandidateerror` logged | **STUN works: Google, Twilio, VoIPBuster and Nextcloud each returned `srflx(149.22.84.142)`, but every server also reported `code=701 host lookup received error` on the first attempt, so name resolution here is flaky and redundancy is what makes the first try land. `stun.services.mozilla.com` and `stun.stunprotocol.org` returned nothing. TURN is dead: `turn.free-1.manual.to:443?transport=tcp` → `code=701 Failed to establish connection`, `turn.manual.to` likewise, OpenRelay allocated nothing. The free relay list was removed and the STUN set widened.** |
| Stalled path, measured | Two peers on `npm run preview` with every local candidate address rewritten to `192.0.2.1:1` (TEST-NET), so no pair can be reached | **Reproduces the worst case: the raw agent sat in `new` for 120 s with zero `iceconnectionstate` events, and the pre-deadline build left both screens at `Waiting for the direct path…` for 2.5 min and counting — no failure to react to, no retry, no error. This is why the retry is armed on a clock and not only on `failed`.** |
| Retry + honest failure, live | Same blackholed peers on the deadline build | **Pass — the handshake restarted on the deadline, and once `MAX_RESTARTS` ran out both devices showed `Failed · Not connected` with *"No path was found between the two devices. Retry, or put one of them on mobile data…"* instead of hanging.** |
| Deadline does not fire on a good call | Same build, peers unpatched | **Pass — reached `Connected` in ~8 s and stayed there through 120 s of polling; no retry, no error.** |
| Offerer election stability | `npx vitest run src/modules/connection/SignalBus.test.ts` | **Pass — 3/3.** The election now reads join time, so it survives the heartbeat: the same pair yields the same offerer after `ts` crosses, the later joiner never takes the offer, and a peer that sends no join time still leaves exactly one offerer. Before this, `(ts, id)` handed the offer to the other device 7 s into a stalled handshake and both sides re-offered at each other. |
| Connect deadline, unit | `npx vitest run src/modules/connection/LinkSession.test.ts` | **Pass — 3/3.** Fake timers + a stubbed broker: no path by 15 s closes the agent and re-offers with `Retrying the direct path…`; three stalls exhaust `MAX_RESTARTS` and raise the no-path error; `markConnected()` disarms the deadline for good. |
| Hosting live | `https://dharma-labs.github.io/opencall/` (GitHub Pages from the `gh-pages` branch) | **Pass — `/`, the JS and CSS bundles, `sw.js`, `manifest.webmanifest` and `favicon.svg` all HTTP 200; the served shell renders `New call`, `Chats`, `History`, `Settings` and emits links on the Pages origin.** |
| Pages auto-deploy | `.github/workflows/pages.yml` | **Blocked, not verified — the push was rejected with *"refusing to allow an OAuth App to create or update workflow without `workflow` scope"*. Publishing is currently a manual step: `npm run build`, then commit `dist/` to `gh-pages`.** |
| Production serve | `npm run preview` | **Pass — `index.html`, the JS bundle and the CSS all 200; the served shell shows `Chats`, `History`, `Settings`, `New call`, `Paste a link to join`, `Send the link`, `Copy link` and the theme/accent/wallpaper switcher.** |
| PWA assets in build | `npm run build` | **Pass — `manifest.webmanifest`, `sw.js`, `favicon.svg`, `favicon.ico`, `favicon.png`, `icons/` (192, 512, maskable-512, apple-touch-180, favicon-32) all emitted to `dist/`** |
| Desktop shell boot (Electron) | `npx electron .` | **Pass — the window loaded `opencall://app/index.html` and the renderer ran; the only console output was Electron's dev-time CSP notice, which the packaged build silences.** |
| Desktop package (Electron) | `npm run desktop:dist` | **Pass — rebuilt after the UI redesign with electron-builder 26.18.0 / Electron 45.4.1: `release/OpenCall-Setup-1.0.0.exe` (123,103,709 B ≈ 116.6 MiB), `release/OpenCall-Portable-1.0.0.exe` (111,738,603 B ≈ 106.6 MiB), `release/win-unpacked/OpenCall.exe`.** |
| Desktop build (Tauri 2) | `npm run desktop:tauri:build` | See §8 — reports its own result |
| Mobile platform added | `npx cap add android` + `npx cap sync android` | **Pass — `android/` generated and the web build copied into `android/app/src/main/assets/public`; camera/microphone permissions added to `AndroidManifest.xml`** |
| Android APK | `cd android && ./gradlew assembleDebug` | **Pass — `app-debug.apk` (4,598,191 B ≈ 4.39 MB), copied to `OpenCall-1.0.0-debug.apk`. Built with Capacitor 8 / AGP 8.13.0 / Gradle 8.14.3 on Temurin JDK 21.0.12 (see §8).** |
| Android launcher icon | `node scripts/generate-icons.mjs`, then `unzip -l` on the APK | **Pass — the APK previously shipped Capacitor's default icon. The generator now writes legacy `ic_launcher`/`ic_launcher_round` plus adaptive `ic_launcher_foreground` for every density, and `ic_launcher_background` is the app charcoal `#0E0E14` instead of white. Verified inside the APK: `res/mipmap-hdpi-v4/ic_launcher.png` is the new 816 B glyph, not the old 2,786 B default.** |
| Launch screen | `npm run dev` → first paint | **Pass — the "OpenCall / by Dharmendra" splash renders, then fades out once `document.fonts.ready` resolves (900 ms floor, 520 ms fade). Implemented in `src/components/common/Splash.tsx`, gated in `src/App.tsx`.** |

### What has NOT been verified
The link handshake, chat and delivery receipts were verified with two peers in one
browser on one machine, which exercises signalling, trickle ICE, the data channel
and the encryption path — but not a real network hop. Still unproven here: voice,
video and screen sharing over an actual call, file transfer, a connection that
must fall back to a TURN server of your own, and two devices on different carriers or
different cities. Those need a second physical device.


---

## 2. Constraints honoured

- **No backend of any kind.** The production bundle is static files only; there
  is no server process, database, or cloud service that OpenCall owns or operates.
- **Dependencies.** No Express, Firebase, Supabase, MongoDB, PostgreSQL, SFU/MCU,
  external auth, analytics or paid APIs. The one added dependency is `mqtt`
  (mqtt.js), used purely as a client against a public broker for the handshake.
- **Browser-native primitives only.** RTCPeerConnection, RTCDataChannel,
  MediaDevices/getUserMedia/getDisplayMedia, WebCrypto (`crypto.subtle`),
  CompressionStream/DecompressionStream, IndexedDB, localStorage.
- **Signalling uses a public broker; public STUN is the only built-in ICE path.**
  `SignalBus` exchanges SDP/ICE through `wss://broker.emqx.io:8084/mqtt`
  (with `wss://test.mosquitto.org:8081/mqtt` as backup, both replaceable in
  Settings) so a link alone is enough to connect two devices in different cities.
  `buildIceConfig()` puts four public STUN servers in
  `RTCPeerConnection.iceServers` and nothing else; TURN is available only through
  the custom-servers field, because every free public relay probed from this
  network is dead and a dead relay stalls the handshake rather than saving it.
- **No renegotiation after setup.** Audio + video `sendrecv` transceivers are
  pre-created on the offer, so starting a call needs no second SDP exchange.

---

## 3. Implemented features (verified by build/tests/review)

### 3.1 Connection & signalling
- **Link mode (the default).** `SignalBus` joins a room — a 9-character code from
  a 31-symbol alphabet — on a public MQTT broker over WebSocket and publishes
  retained presence (`oc/v1/<room>/p/<id>`: id, display name, timestamp). Opening
  the link on the second device is the whole ritual: presence frames meet,
  `electOfferer()` compares `(born, id)` on both sides so exactly one device
  creates the offer, SDP rides `oc/v1/<room>/d/<id>` with QoS 1, and ICE is
  trickle — `PeerManager.setCandidateSink()` streams every `icecandidate`
  straight to the peer, and candidates that arrive before the remote
  description are queued. `born` is the moment a device joined and never moves;
  the election used to read `ts`, which the 9 s heartbeat rewrites, and the
  offerer then changed hands mid-handshake (measured: 7 s in, both devices
  started re-offering at each other). Presence refreshes every 18 s and is
  treated as stale after 75 s, so a room stays open for a late joiner without
  holding a dead peer; `bye` and an empty retained frame end it. Broker failure
  falls over to the backup, and `LinkSession` re-offers after 12 s if the answer
  never comes.
- **Trickle ICE, STUN only, retried on a deadline.** `buildIceConfig()` adds
  `bundlePolicy: 'max-bundle'` and four public STUN servers, with no candidate
  pool. `LinkSession.restart()` closes the agent and handshakes again on a fresh
  one, up to `MAX_RESTARTS` (2), and only when the attempts run out does an error
  reach the screen. It is armed two ways: on an `failed` ICE report, and on
  `CONNECT_DEADLINE_MS` (15 s) after both descriptions are exchanged. The
  deadline is not decoration — an agent whose candidate pairs are all
  unreachable was measured to sit in `new` for 120 s emitting **no**
  `iceconnectionstate` event at all, so waiting for a failure report is waiting
  for something that never arrives, and the call hangs at "Waiting for the
  direct path…". Address discovery also genuinely fails a name lookup on the
  first attempt here and succeeds later.
- Manual SDP exchange: host creates an offer, guest returns an answer — **one code
  each way**, instead of the previous three. Kept as the **Connect by hand**
  fallback for networks that block the broker.
- **Lossless shared-dictionary compression.** A 31-entry `SDP_DICTIONARY` replaces
  the tokens every SDP repeats (`m=audio 9 UDP/TLS/RTP/SAVPF`, `a=ice-ufrag:`,
  `a=candidate:`, `network-cost`, the common codec payload types, …) with single
  bytes, then gzip (`CompressionStream`) then base64url, prefixed `OC2:`. Measured
  effect on a real Chrome offer: **3086 chars of SDP → 1368 chars of payload**, so
  it fits one 1800-character QR code. `OC1:` (plain gzip) is still decoded for
  compatibility.
- Multi-part QR remains as a fallback for unusual payloads
  (`OC1C.<index>.<total>.<checksum>:<chunk>`), with an FNV-style integrity
  checksum, out-of-order reassembly, and a 40-part cap.
- **Invite links.** `buildShareLink()` produces `…#oc=<payload>`; link fragments
  never reach a server. `readShareLink()` accepts a full link or a bare
  `OC2/OC1/OC1C` payload. `buildRoomLink()` (link mode) puts the room in the
  fragment too, and inside a packaged Electron/Tauri/Capacitor shell — where the
  WebView origin is `opencall://`, `*.localhost` or Capacitor — it points the link
  at `PUBLIC_SITE_URL` so a desktop or APK invite still opens something real.
- **Zero-camera path.** The host scans the guest's reply in-app (`completeAsHost`
  is wired to the same `QrScanner`), so neither side has to type or paste anything
  when both have cameras; copy/paste and JSON export/import remain as disclosed
  fallbacks for any payload size.
- Integrity + validation: rejects incomplete sets, corrupted parts, wrong
  versions, mismatched SDP types, and non-OpenCall text.
- QR generation (`qrcode`, 720 px / error-correction `L` for payloads over 900
  chars so a dense code still scans) and QR scanning (`jsQR` + getUserMedia,
  `facingMode: 'environment'`, 2500 ms dedupe).
- Two data channels: `opencall-control` (ordered, reliable) and
  `opencall-file` (binary chunks).

### 3.2 Chat
- Real-time text messages over the control channel.
- Delivery acknowledgements (sent → delivered) with a 12 s ack timeout.
- Read receipts, typing indicators (6 s TTL), replies and an emoji picker.
- Message sanitising (`MAX_MESSAGE_CHARS = 4000`) and local-only history.

### 3.3 Voice & video calling
- Voice and video calls using the pre-created transceivers (no renegotiation).
- Mic mute, camera on/off, camera switch (facingMode), device selection.
- Screen sharing via `getDisplayMedia`, with stop/restore.
- Hidden remote `<audio>` element for voice-only sessions; tap-to-hear fallback.

### 3.4 File transfer
- 16 KiB chunks with an 8-byte header (uint32 slot + uint32 chunkIndex).
- Backpressure via `bufferedAmount` (1 MiB high-water / 256 KiB low-water marks).
- Progress reporting, cancel, and SHA-256 integrity verification (files < 128 MiB).
- Received files assembled into an object URL for download.

### 3.5 Security
- DTLS/SRTP from WebRTC for transport.
- Optional application-layer encryption: ECDH P-256 → HKDF-SHA256 → AES-256-GCM
  (`crypto.subtle`), each message carrying `{ v, enc: { iv, ct } }`.
- Deterministic 20-digit **safety code** derived from SHA-256 of the sorted
  public keys, shown on both ends for out-of-band comparison.

### 3.6 Diagnostics, history & storage
- Network panel reading `RTCPeerConnection.getStats()` (candidate pair, RTT,
  bytes, packet loss, codecs, ICE/connection state) on a poll interval. Reached
  from the session's *Details* row; its three sub-tabs are Network / Security /
  Log.
- Security tab (safety code, encryption state, honest disclaimers).
- **History tab** (`src/components/history/HistoryView.tsx`): lists every stored
  session — peer, relative time, last message and a message-count pill — and opens
  a read-only transcript in a wide modal with a *Delete from this device* action
  (`clearConversation`).
- **Settings tab** (`src/components/settings/SettingsView.tsx`): *Connection*
  (public-STUN toggle with a live `describeIcePlan()` summary of what the current
  configuration will do, and an optional relay-servers textarea), *Privacy*
  (encryption + history toggles), *Audio* (echo cancellation, noise suppression,
  auto gain), *Devices* (microphone/camera pickers + refresh), and a *This session*
  block (status, role, peer, safety code, runtime) with a collapsible activity log.
- IndexedDB conversation history (capped at 500 messages, storing the peer label)
  and localStorage preferences (`opencall.preferences.v1`). History is on by
  default so the History tab has data to show.

### 3.7 UI
- Premium-minimalist dark charcoal theme with a WhatsApp-familiar chat and
  Apple-style restraint. The whole app is restyled from three files —
  `tailwind.config.js`, `src/styles/index.css` and the component class names —
  because there is **not a single hard-coded colour literal in any `.tsx`**.
- **Top-centred section shell.** `App.tsx` is a three-section shell —
  **Home / History / Settings** — with the tabs sitting **dead centre of the top
  bar** on desktop (`.navbar-row` → `.tabs`) and dropping to their own full-width
  row on phones (`.tabs-wide`) so every target stays thumb-sized. Starting a
  handshake or a session always returns the user to Home; only browsing between
  sessions leaves the tab alone.
- **Home** carries the whole pre-connection flow in one column (max-w-2xl):
  *Create a connection* / *Join a connection* as full-width `list-row` buttons, a
  short *Two codes, one each way* explainer with the corrected STUN wording, a row
  of device-readiness pills, and recent activity. The old "host-only candidates"
  copy is gone.
- **Connection setup** is two numbered steps: *Step 1 · Let them scan this* (one
  QR, a copy-invite-link button, and a native *Send link* share button where
  `navigator.share` exists) and *Step 2 · Scan their answer* for the host; the
  guest gets a segmented *Scan / Paste* control whose scan mode auto-starts the
  camera. Typing or pasting is behind a `<Disclosure>` so the primary path stays
  clean.
- **Design tokens from the reference apps** `dharma-labs.github.io/galib` and
  `crazyocr.vercel.app`:
  - Charcoal surface ramp (`#08080c` → `#0e0e14` → `#13131a` → `#191922` →
    `#1f1f29`), near-white primary text `#f4f4f4`, muted grey `#a5a5b1`.
  - Accent `#4ca0ff` (reference dark-mode primary), status colours
    `#30d158` / `#ffd60a` / `#ff453a`.
  - Radii 10 / 14 / 18 / 24 px; subtle translucent borders.
  - Base layer: tightened tracking (−0.011em body, −0.022em headings),
    `text-wrap: balance` headings, Inter OpenType features (`cv11`, `ss01`),
    10 px clipped scrollbars, 26 % accent selection.
  - Primary buttons keep the reference light-sweep hover animation.
- **Conversation layer** (the familiarity work):
  - Day dividers (`Today` / `Yesterday` / short date) between date changes.
  - Bubble runs: consecutive messages from one sender group together and only
    the last bubble of a run gets a tail (`clip-path`, 9×13 px), so a stack
    reads as a conversation instead of a list.
  - Outgoing bubbles `#1c4a72`, incoming `#1e1e26` — the one distinction a chat
    must make instantly.
  - Timestamp and delivery ticks live inside the bubble (`✓` sent, `✓✓`
    delivered, accent `✓✓` read, red on ack timeout); message actions
    (reply / copy) are hover-revealed on desktop and always visible on touch.
  - Composer is a single rounded pill (`rounded-3xl`) with clip and emoji
    buttons plus a circular accent send button.
- **Chrome layer**: a frosted `.appbar` (`backdrop-blur-xl`), an avatar with a
  presence dot, a segmented control for the side-panel tabs, circular call
  buttons (`h-12 w-12`) with a filled accent "off" state and a red end-call
  button, and a `rise` entrance animation that is restrained to one per screen.
- **Launch screen**: `src/components/common/Splash.tsx` renders the brand mark
  (charcoal tile + accent ring + light dot) at 56 px inside a pulsing accent
  halo, the wordmark **OpenCall**, the line **by Dharmendra** in 0.28em-tracking
  uppercase, and a shimmer loading bar. `App.tsx` holds it until
  `document.fonts.ready` settles and removes it after a 900 ms floor plus a
  520 ms fade, so the app never flashes a half-drawn layout.
- Mobile pass: `viewport-fit=cover` with `env(safe-area-inset-*)` padding on the
  app root so nothing hides under a notch or home indicator, `touch-action:
  manipulation` to drop the double-tap zoom delay, larger touch targets
  (2.75rem buttons, 2.5rem composer/call controls) under `@media (pointer:
  coarse)`, and a phone-only session row with a slide-over diagnostics panel.
- Platform UI: an offline strip, a runtime badge (browser / installed app /
  desktop app / mobile app) and a dismissible install prompt that shows a real
  install button where `beforeinstallprompt` fires and written *Add to Home
  Screen* steps on iOS, which never fires it.

### 3.8 Platform targets
- **PWA**: `manifest.webmanifest` (relative `id`/`start_url`/`scope`, standalone
  display, maskable icon, `?action=create|join` shortcuts) and `sw.js`
  (precached shell, network-first navigations, cache-first immutable assets,
  `skipWaiting` + `clients.claim`, no cross-origin interception). Registered only
  for the production web build.
- **Electron desktop**: `electron/main.cjs` serves `dist/` over a privileged
  `opencall://` scheme (a secure context, which is what makes `mediaDevices`
  exist in a desktop window), applies a `default-src 'self'` CSP, allow-lists the
  media/display-capture/clipboard/fullscreen/pointer-lock permissions and denies
  everything else, hands external links to the system browser, and runs the
  renderer with `contextIsolation: true`, `sandbox: true`, no Node.
- **Tauri 2 desktop**: a window and nothing else — no commands, no plugins, no
  IPC surface. Same `dist/` bundle, same CSP, NSIS + MSI targets.
- **Capacitor mobile**: `capacitor.config.ts` with `androidScheme: 'https'` so the
  Android WebView is a secure context, plus camera/microphone/foreground-service
  permissions and optional-hardware declarations in `AndroidManifest.xml`.


---

## 4. Known limitations & bugs

1. **Strict NATs need a TURN server you provide.** The four public STUN servers
   let most home and mobile networks hole-punch a direct path, but a symmetric
   NAT or carrier-grade NAT with no UDP hole cannot be crossed without a relay,
   and no working free public relay exists to ship. Type your own coturn entry
   into Settings → Connection → Custom ICE servers; the UI says the same.
2. **Media paths are unverified in a real call.** Call control, device switching
   and screen sharing are wired and compile, but have not been exercised between
   two live peers.
3. **The one-QR fit is verified against a representative SDP, not every device.**
   The test uses a real Chrome offer (audio + video + 2 data channels). A browser
   that emits an unusually large candidate set can still exceed the 1800-character
   budget, in which case `splitForQr()` falls back to the multi-part flow.
4. **Large files depend on the peer's buffer draining.** If the remote tab stalls
   indefinitely, a transfer can remain "in progress"; cancel is available.
5. **Encryption is a complement, not a replacement.** It sits on top of DTLS; the
   safety code must still be compared out-of-band to rule out a MITM.
6. **History is local only.** There is no sync and no recovery; clearing the
   browser store erases the conversation.

---

## 5. Architectural decisions

- **No signalling server** → SDP/ICE interchange is a manual, user-driven step:
  one QR code each way (dictionary-packed so it fits), a `#oc=` invite link,
  copy/paste, or a JSON file.
- **STUN by default, TURN opt-in** → `buildIceConfig()` reads
  `preferences.usePublicStun` and `preferences.customIceServers` and hands the
  result to `PeerManager`, which passes it to `new RTCPeerConnection(config)`.
  Public STUN makes cross-city, cross-carrier connections possible without a
  backend; TURN stays off because a relay sees the plaintext.
- **Pre-created transceivers** → avoids a second renegotiation round, which would
  otherwise require another manual exchange after the connection exists.
- **Explicit app-layer envelope** (`{ v, p }` plain or `{ v, enc }` encrypted)
  → lets encryption be toggled without changing the transport, and keeps the
  inner-message union (`hello/msg/ack/read/typing/file-*/key/bye`) versioned.
- **Single React context** (`OpenCallProvider` / `useOpenCall`) as the
  orchestrator, keeping WebRTC, media, encryption, storage and files decoupled
  from the presentational components.
- **Strict TypeScript, no `any` escape hatches** in the verified source.

---

## 6. Phase checklist

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Project scaffold, tooling, theme, types | Complete |
| 2 | Peer connection, manual SDP, QR + copy/paste + file exchange | Complete |
| 3 | Chat, acks, read receipts, typing, replies, emoji | Complete |
| 4 | Voice & video calls, screen sharing, device selection | Complete (wired; live call unverified) |
| 5 | Chunked file transfer with backpressure & integrity | Complete (wired; live transfer unverified) |
| 6 | Security, diagnostics, local storage, UI polish, docs | Complete |

---

## 7. How to run

```bash
npm install
npm run dev        # web app, http://localhost:5173
npm run typecheck  # strict type check
npm test           # unit tests
npm run build      # production bundle in dist/
npm run preview    # serve the built bundle
```

Desktop and mobile targets:

```bash
npm run desktop:start        # build, then open the Electron window
npm run desktop:dist         # Electron installer + portable exe -> release/
npm run desktop:tauri:dev    # Tauri window against the dev server
npm run desktop:tauri:build  # Tauri NSIS/MSI bundles -> src-tauri/target/release/bundle/
npm run mobile:sync          # build, then copy dist/ into the native projects
npm run mobile:android       # sync, then open Android Studio
```

Android APK, without Android Studio:

```powershell
$env:JAVA_HOME      = "$env:USERPROFILE\.jdks\jdk-21.0.12+8"   # Gradle 8.14 cannot run on JDK 25
$env:ANDROID_HOME   = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

npm run mobile:sync
cd android
.\gradlew.bat assembleDebug
# -> android\app\build\outputs\apk\debug\app-debug.apk
```

`assembleRelease` produces an unsigned release APK that will not install until it
is signed; the debug APK is signed with the machine's debug keystore and installs
directly with `adb install -r app-debug.apk`.

To try it: open the app on two devices (they may be in different cities — a public
STUN server is on by default), choose **Create a connection** on one and **Join a
connection** on the other, then either scan the one QR each way, or open the invite
link on the second device to skip the camera entirely. If the two networks are
strict, add a relay in **Settings → Connection**.

---

## 8. Platform build outcomes (this machine)

Measured on Windows 11, Node 24.17.0, npm 11.13.0, rustc/cargo 1.98.1,
Temurin JDK 21.0.12, Android SDK (platforms 34–37, build-tools 34.0.0–37.0.0,
`adb`).

| Target | Outcome | Artifact |
| --- | --- | --- |
| Web / PWA | Built and served successfully (rebuilt after the UI redesign) | `dist/` — `index.html` 1.52 kB, CSS 41.27 kB, JS 411.42 kB; shipped as `OpenCall-1.0.0-web.zip` (284,998 B) |
| Electron desktop | **Built and packaged** after the UI redesign | `release/OpenCall-Setup-1.0.0.exe` (123,103,709 B ≈ 117.4 MiB), `release/OpenCall-Portable-1.0.0.exe` (111,738,603 B ≈ 106.6 MiB), `release/win-unpacked/OpenCall.exe` |
| Tauri desktop (binary) | **Compiled** in 3m 05s (release profile, after the UI redesign) | `src-tauri/target/release/opencall.exe` (3,279,360 B ≈ 3.13 MiB) |
| Tauri desktop (NSIS installer) | **Built** | `src-tauri/target/release/bundle/nsis/OpenCall_1.0.0_x64-setup.exe` (1,253,965 B ≈ 1.20 MiB) |
| Tauri desktop (MSI) | **Failed — environment, not configuration.** Tauri downloads the WiX toolset to `%LOCALAPPDATA%\tauri\WixTools314`; the sandboxed shell blocks that write, so it reports `failed to bundle project: Access is denied. (os error 5)`. The binary and NSIS installer above are produced by the same run and are complete. Re-run `npm run desktop:tauri:build` from a normal terminal to get the MSI. | — |
| Capacitor Android platform | **Added and synced** | `android/` with the web build in `android/app/src/main/assets/public` |
| Android APK (debug) | **Built.** `gradlew assembleDebug` succeeded on Temurin JDK 21.0.12 with AGP 8.13.0 / Gradle 8.14.3 / compileSdk 36. The machine only ships JDK 25 (Android Studio's `jbr`), which Gradle 8.14 rejects with *Unsupported class file major version 69* — pointing `JAVA_HOME` at the JDK 21 in `~\.jdks` resolves it. | `android/app/build/outputs/apk/debug/app-debug.apk` (4,598,191 B ≈ 4.39 MB), copied to `OpenCall-1.0.0-debug.apk` |
| Android AAB (release) | **Not built.** `bundleRelease` needs a real signing key; the debug APK is the installable artifact. | — |
| Capacitor iOS platform | **Not added.** `npx cap add ios` requires macOS with Xcode. `ios/` is intentionally absent. | — |

### 8.1 Downloadable artifacts in the project root

All six are current — rebuilt in the same run as the sources documented above.

| File | Size | What it is |
| --- | --- | --- |
| `OpenCall-Setup-1.0.0.exe` | 116.62 MiB | Electron installer (NSIS, per-user, choosable location) |
| `OpenCall-Portable-1.0.0.exe` | 106.0 MiB | Electron single-file portable build |
| `OpenCall_1.0.0_x64-setup.exe` | 1.20 MiB | Tauri NSIS installer |
| `OpenCall-1.0.0-tauri-portable.exe` | 3.13 MiB | Tauri binary, runs with no installation |
| `OpenCall-1.0.0-debug.apk` | 4.12 MB | Android debug APK, installs directly with `adb install -r` |
| `OpenCall-1.0.0-web.zip` | 284,998 B | Static web/PWA build — unzip and serve over HTTPS |

The desktop builds are unsigned (no code-signing certificate is configured), so
Windows SmartScreen will warn on first launch. Signing is a distribution concern
and was deliberately left out of scope.

