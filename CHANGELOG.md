# Changelog

## 0.1.2 — 2026-10-23

- Fix nested header, workspace and chat backgrounds multiplying surface opacity: three 72% tints previously composed to 97.8%, making a saved background appear absent.
- Let deeper regions clear previously tinted ancestors, independent of anchor order, while retaining native control and text opacity.
- Add a nested conversation regression and check composed opacity in Web and desktop workflows, including a populated chat layout fixture without model requests.

## 0.1.1 — 2026-10-23

- Fix backgrounds disappearing when switching back to a cached workspace: observe visibility changes on transparent layout ancestors, including hidden workspace paths.
- Keep streaming text and message row style changes outside the background rescan path.
- Add a regression for hidden workspace activation and verify repeated / rapid switching between two real workspaces on Web and the packaged macOS desktop app.
- Ensure end-to-end checks select visible panes when several cached workspaces remain mounted.

## 0.1.0 — 2026-10-23

- First desktop and Web release for Paseo's v0.13 plugin API.
- Six bundled landscapes and custom HTTPS image addresses.
- Independent image / surface opacity, blur, brightness, fit and placement.
- Local draft previews, host settings persistence, synchronization and revision conflict recovery.
- Sidebar, settings and Command Center entries in English and Chinese.
- Scoped surface adaptation with cleanup on off, disable and reload.
- Verified on the unmodified macOS desktop application with Electron 44.2.0 and the matching Web UI; 15 regression checks and CI package validation included.

The public v0.12 Web client, native mobile, local image uploads and operating system window transparency are outside this release's supported scope. Windows and Linux have not been tested.
