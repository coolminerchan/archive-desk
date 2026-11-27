# archive-desk

A desktop utility for client-session capture, archive inspection, and scene backups.

## Setup

1. Download the Windows x64 package from Releases.
2. Extract the complete package into a writable directory.
3. Keep `runtime` and `resources` beside the executable.
4. Install [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/consumer/) if it is missing.

Live capture requires administrator privileges. Existing archives can be inspected without elevation. Python, Node.js, and TShark are included in the portable package.

## Usage

Start capture before signing in through the original client. Open the views you want to preserve and wait for their contents to load. Exit the client or stop capture to finish the archive.

The application has four sections: account backup, saved records, home decoration, and settings. Saved records are grouped by category. Capture diagnostics, manual connection options, and detailed evidence can be expanded when needed.

Account records and visited-scene layouts are saved separately. ZIP, PCAP, and PCAPNG files can also be opened for inspection.

The capture contains data returned during that session. Missing responses remain unknown. Keep the original recording when further inspection may be needed.

## Build

Requirements: Node.js 24, npm, Visual Studio 2022 C++ Build Tools, and Windows SDK.

Use the runtime package matching the source version:

```powershell
$RuntimePackage = Read-Host 'Path to the matching Windows package'
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap_capture_build.ps1 -RuntimePackage $RuntimePackage
```

The build script verifies its inputs, prepares dependencies, and builds the desktop package from source.

## Issues

Include the application version, Windows build, client channel, reproduction steps, and error text. Review diagnostic files before attaching them. Keep account archives and raw recordings private.

## Credits

Thanks to **Shuiyin (水音)** for the original capture tooling; a collected copy is available in [backup-tool](https://github.com/inori-dream/miaomiao-launcher/tree/main/backup-tool).

- [inori-dream/miaomiao-launcher](https://github.com/inori-dream/miaomiao-launcher) — capture, decoding, and exploration tooling.
- [BanterSR/Lolo](https://github.com/BanterSR/Lolo) — protocol message identifiers.
- [byzp/of-ps](https://github.com/byzp/of-ps) — protocol definitions and message mapping.

Thanks also to the developers of the runtime, parsing, and interface components used by this project.
