# 0.7.1

- Retry update checks and package downloads through GH-Proxy when the direct connection fails.
- Bound connection and stalled-download waits; restart interrupted downloads with independent digest checks.
- Display the active update route and retain the same signature, repository, product, and archive validation.

# 0.7.0

- Record the request profession and social-list category with original PacketId and connection context.
- Pair only unique requests and responses. Missing, failed, duplicate, and incomplete exchanges stay unknown.
- Separate six-category life base coverage, pictorial-history coverage, and classified social-list coverage in the live and final reports.
- Preserve all snapshots and original evidence, with bounded display summaries and additional browsing instructions.

# archive-desk v0.6.0

Portable Windows x64 release.

## Downloads

- **OverField-Capture-0.6.0-Windows-x64.zip** — complete application with its runtime components.
- **OverField-Capture-0.6.0-Source.zip** — source and build scripts.
- **SHA256SUMS.txt** — checksums for the application, source, and update descriptor.
- **capture-update.json** — signed update descriptor used by the application.

Download the Windows package to run the application. GitHub's automatic source archives do not include the portable runtime.

## Getting started

1. Extract the entire Windows package into a writable directory.
2. Run `账号采集工具.exe`. Keep `runtime` and `resources` beside it.
3. Select one-click capture and allow the administrator prompt. Sign in through the original client after recording is ready.
4. Browse the views you want to preserve, then exit the client or stop capture. Wait for analysis and export to finish.

The package includes **使用说明.txt** in Chinese and **Capture-guide.md** in English. [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/consumer/) is required if it is not already installed.

## Included

- One-click recording, client discovery, and account inspection.
- Equipment observations, exploration records, and captured progress.
- A separate visited-home collection with individual and collection exports.
- Own-scene summaries and export of distinct scene snapshots.
- Compatibility with garden directories, nested garden ZIPs, and legacy scene indexes.
- Validated exports with ownership checks, SHA-256 verification, and replacement only after the copy passes validation.
- Preflight checks, recording recovery, local error logs, and optional update checks.

Verified updates install into a separate directory. The previous version remains available for rollback.

## Notes

Capture preserves data returned during the session. Unopened lists and unloaded scene areas remain unverified. Walk through the relevant home areas and wait for furniture to load.

The displayed login UID and internal role ID remain separate. Archive metadata is not treated as a fresh login.

The application is Windows x64 only. Client channels may differ in connection handling and protocol support.

## Validation

60 Python tests, 35 Node tests, native-window workflows, and a clean source build passed. Recorded-data replay preserved the original account responses and all 59 homes in the validation collection.

## Credits

Thanks to **Shuiyin (水音)** for the original capture tooling.

- [inori-dream/miaomiao-launcher](https://github.com/inori-dream/miaomiao-launcher)
- [BanterSR/Lolo](https://github.com/BanterSR/Lolo)
- [byzp/of-ps](https://github.com/byzp/of-ps)
