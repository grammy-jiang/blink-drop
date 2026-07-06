# Blink-Drop — iOS Primer (zero to device)

| | |
|---|---|
| **Status** | Draft v0.1 |
| **Date** | 2026-07-07 |
| **Audience** | A web developer with **no iOS/Xcode/Swift experience**, deploying to a personal **iPhone 15 Pro Max** with a **free Apple ID** (no paid Developer Program) — decisions confirmed in `../00-blueprint.md` and `architecture.md`. |
| **Goal** | Get the receiver app building and running on your own iPhone, and understand the day-to-day loop — without prior Apple-platform knowledge. |

This is the *how*. The *what/why* of the app is `architecture.md`.

---

## 1. What you need

| Thing | Note |
|-------|------|
| A **Mac** | Xcode is macOS-only. Any recent Mac that runs a current macOS. |
| **Xcode** | Free from the Mac App Store. Large (~several GB) — install ahead of time. |
| Your **iPhone 15 Pro Max** | The Simulator has **no camera**, so a real device is mandatory for this app. |
| A **USB-C cable** | For first install and Developer Mode. Wireless debugging works after. |
| A free **Apple ID** | The one you already use. No enrollment, no payment. |

## 2. Install Xcode

1. Mac App Store → search **Xcode** → install.
2. Open Xcode once; accept the license; let it install "additional components."
3. (If a build ever complains about command-line tools) run `xcode-select --install`.

## 3. Create the project

1. Xcode → **File ▸ New ▸ Project… ▸ iOS ▸ App**.
2. Interface **SwiftUI**, Language **Swift**. Name it `BlinkDrop`.
3. **Signing & Capabilities** tab → **Team**: pick your Apple ID's **Personal Team** (add your Apple ID under Xcode ▸ Settings ▸ Accounts if it isn't listed). Set a unique **Bundle Identifier**, e.g. `com.yourname.blinkdrop`.

> **Terminology map (web → iOS):** a *target* ≈ a build output; a *scheme* ≈ a run configuration; *Info.plist* ≈ app manifest; *bundle identifier* ≈ a unique app id like a reverse-domain package name.

## 4. Add URKit (the UR/MUR library)

1. **File ▸ Add Package Dependencies…**
2. Paste the URKit repository URL (`https://github.com/BlockchainCommons/URKit`).
3. Choose a version rule (e.g. "Up to Next Major"), add it to the `BlinkDrop` target.
4. Xcode commits a `Package.resolved` — **check it into git** so the version is pinned (architecture §8).

> SPM (Swift Package Manager) is the npm-equivalent baked into Xcode. `Package.resolved` ≈ a lockfile.

## 5. Grant camera permission (required)

The app **crashes when it opens the camera** if this string is missing.

1. Select the project ▸ your target ▸ **Info** tab.
2. Add a key: **Privacy – Camera Usage Description** (`NSCameraUsageDescription`).
3. Value: `Blink-Drop uses the camera to scan the animated QR codes on another screen.`

No other permission is needed (no network, photos, or location).

## 6. Run on your iPhone

1. **Plug in** the iPhone. On the phone, tap **Trust** for this computer if prompted.
2. **Developer Mode** (iOS 16+): Settings ▸ **Privacy & Security ▸ Developer Mode** → on → restart the phone.
3. In Xcode's top bar, select your **iPhone** as the run destination (not a Simulator).
4. Press **Run** (⌘R). First build takes a while.
5. First launch shows **"Untrusted Developer."** On the phone: Settings ▸ **General ▸ VPN & Device Management** → your Apple ID → **Trust**. Re-launch the app.

The app is now on your phone.

## 7. The 7-day reality (free-account limits)

Free Apple ID signing has limits you must know so nothing surprises you:

- **App signature expires ~7 days.** After that the app won't launch. **Fix:** connect and press Run again — it re-signs and reinstalls. (A paid Developer Program, $99/yr, extends this to a year — revisit only if the re-sign cadence annoys you; see blueprint §9.)
- **Up to 3 sideloaded apps** per free account at once.
- **10 registered devices** per account per type.

None of this blocks personal development — it just means "if it stopped opening, re-run from Xcode."

## 8. The daily dev loop

```
edit Swift  →  ⌘R (build + install + launch on phone)  →  test with a live QR animation on your Mac screen
     ▲                                                                   │
     └───────────────────────  read Xcode console / set breakpoints  ◄───┘
```

- **Console:** the bottom pane in Xcode shows `print(...)` output and crashes with stack traces.
- **Breakpoints:** click a line-number gutter; the app pauses there so you can inspect values (like a browser debugger).
- **Wireless:** after the first cabled run, enable "Connect via network" for the device in Xcode ▸ Window ▸ Devices and Simulators, then unplug.
- **Test target:** for this app, point the phone at the **web sender** (or the M0 web receiver's counterpart) running on your Mac screen — that's the real end-to-end loop.

## 9. First-timer gotchas (and the fix)

| Symptom | Fix |
|---------|-----|
| "Signing requires a development team" | Signing & Capabilities → select your Personal Team (§3) |
| "Untrusted Developer" on launch | Trust the cert on the phone (§6.5) |
| Camera view is black | Camera usage string missing (§5), or permission was denied — reinstall / reset in Settings |
| iPhone not selectable in Xcode | Trust the computer; enable Developer Mode; replug (§6) |
| App won't open after a few days | Signature expired — re-run from Xcode (§7) |
| Weird build errors after changes | Xcode ▸ **Product ▸ Clean Build Folder** (⇧⌘K), rebuild |

## 10. Swift in five minutes (for a web dev)

- **Optionals:** `String?` is "maybe a string"; unwrap with `if let x = maybe { }` or `guard let`. The compiler *forces* you to handle "nothing" — like strict null-checking.
- **Value vs reference:** `struct` copies (like a plain object literal), `class` is shared by reference. SwiftUI views are `struct`s.
- **`async/await`** exists and works like JS's; camera callbacks are delegate methods (a callback object) rather than promises.
- **SwiftUI is declarative** — you describe the view for a given state and it re-renders on change, conceptually like React. `@Observable` state → views update automatically (architecture §4).
- **No semicolons, strong inference**; `let` = const, `var` = let.

## 11. Pointers

- Apple: "Running your app on a device," SwiftUI tutorials, AVFoundation capture docs (search the current Apple Developer documentation).
- URKit: the repository README + its test suite (`URKitTests`) are the best usage reference (architecture §7).
- When stuck on "how do I do X in Swift," prefer the current Apple docs over old Stack Overflow answers — Swift/SwiftUI have changed a lot across versions.
