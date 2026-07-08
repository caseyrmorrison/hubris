# HUBRIS — iOS (Xcode) Port

This folder contains a complete, dependency-free Xcode project that runs
HUBRIS natively on iPhone and iPad. The entire game is the static web build
(bundled under `HUBRIS/web/`); the app itself is a ~150-line Swift shell that
hosts it in a fullscreen `WKWebView`. There are **no CocoaPods, no Swift
packages, no Capacitor** — just Xcode.

```
apple/
├── HUBRIS.xcodeproj/          the Xcode project
├── HUBRIS/
│   ├── HubrisApp.swift        SwiftUI entry point (fullscreen, dark)
│   ├── GameWebView.swift      WKWebView + hubris:// scheme handler
│   ├── Info.plist             landscape-only, status bar hidden
│   ├── Assets.xcassets/       app icon + launch background color
│   └── web/                   ← the built game (generated, see below)
└── README.md                  this guide
```

---

## Developer guide

### Prerequisites

- macOS with **Xcode 15+** (tested with Xcode 26)
- **Node 18+** (for building the web game)
- An **Apple ID** — a free one suffices for running on your own iPhone;
  a paid Apple Developer membership ($99/yr) is only needed for TestFlight
  and the App Store.

### 1. Build the game into the app

From the **repository root** (not this folder):

```bash
npm run build:ios
```

This runs the production web build and copies `dist/` into
`apple/HUBRIS/web/`, which the Xcode project bundles as a folder reference.
**Re-run it after every game change** — Xcode picks the new files up
automatically on the next build (no project changes needed).

### 2. Run on the iOS Simulator

```bash
open apple/HUBRIS.xcodeproj
```

In Xcode: pick any iPhone simulator in the toolbar and press **⌘R**.
Or from the command line:

```bash
cd apple
xcodebuild -project HUBRIS.xcodeproj -scheme HUBRIS \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

### 3. Run on your own iPhone

1. Connect the iPhone by cable (or set up wireless debugging) and unlock it.
2. In Xcode, select the **HUBRIS** target ▸ **Signing & Capabilities**:
   - Check **Automatically manage signing**.
   - **Team**: choose your personal team (add your Apple ID under
     Xcode ▸ Settings ▸ Accounts if the list is empty).
   - **Bundle identifier**: change `com.example.hubris` to something unique
     to you, e.g. `com.yourname.hubris` (free accounts require uniqueness).
3. Select your iPhone as the run destination and press **⌘R**.
4. First run only: on the phone, go to
   **Settings ▸ General ▸ VPN & Device Management** and trust your developer
   certificate, then launch the app again.

> **Free-account limits:** apps signed with a personal (free) team expire
> after **7 days** — just press ⌘R again to re-install. A paid membership
> extends this to a year and unlocks TestFlight/App Store.

### How it works (for the curious)

- `GameWebView.swift` serves the bundled `web/` folder through a custom
  **`hubris://` URL scheme** rather than `file://`. This matters: WKWebView
  blocks ES-module scripts from file origins (CORS), and a proper origin also
  makes `localStorage` persistence rock-solid — your Mirror of Hubris ranks,
  unlocks, and settings survive relaunches and app updates.
- Audio is WebAudio, unlocked by the game's own first-touch handler
  (`mediaTypesRequiringUserActionForPlayback = []` allows it).
- The game's built-in touch controls (virtual sticks + dash button), PWA
  viewport settings, and small-screen UI all apply as-is.
- Debug builds are **Safari-inspectable**: run the app, then on your Mac open
  Safari ▸ Develop ▸ *your device* ▸ HUBRIS to get a full web inspector.

### Updating the game

Any change to the TypeScript game only needs:

```bash
npm run build:ios      # from the repo root
```

…then ⌘R in Xcode. The Swift shell almost never needs to change.

---

## Deployment guide (TestFlight & App Store)

1. **Join the Apple Developer Program** ($99/yr) with the same Apple ID.
2. In Xcode, set the **Team** to your paid team and bump
   **MARKETING_VERSION / CURRENT_PROJECT_VERSION** for each release.
3. **Archive**: Product ▸ Archive (with *Any iOS Device (arm64)* selected).
4. In the Organizer window: **Distribute App ▸ App Store Connect ▸ Upload**.
   Xcode handles signing, provisioning and upload automatically.
5. On [App Store Connect](https://appstoreconnect.apple.com):
   - Create the app record (name, bundle ID, privacy info — the game
     collects **no data**, which makes the privacy questionnaire trivial).
   - **TestFlight**: the uploaded build appears within minutes; add yourself
     or up to 10,000 external testers.
   - **App Store**: add screenshots (take them in the simulator with
     `⌘S`), a description, and submit for review.

### App Review notes worth knowing

- Apple accepts wrapped web games when they behave like real apps — this one
  ships fully offline, fullscreen, with touch controls and persistent state,
  which is exactly the bar. Avoid mentioning "website" in the description.
- The app icon is generated opaque (no alpha) as App Store validation
  requires; it lives at `HUBRIS/Assets.xcassets/AppIcon.appiconset/`.
- If you ever add remote content or accounts, revisit the privacy answers.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Black screen with "Game build not found" | Run `npm run build:ios` from the repo root, rebuild. |
| Blank dark screen, no message | The `web/` folder is stale — re-run `npm run build:ios`. |
| "Failed to register bundle identifier" | Change `PRODUCT_BUNDLE_IDENTIFIER` to something unique. |
| App won't launch on device ("Untrusted Developer") | Settings ▸ General ▸ VPN & Device Management ▸ trust. |
| App expired after a week | Free-team signing limit — press ⌘R to reinstall. |
| No sound | Sound starts after the first touch (by design); check the mute switch. |
| Save wiped after reinstall | Deleting the app deletes its container — export a save code first (Settings ▸ SAVE DATA). |
