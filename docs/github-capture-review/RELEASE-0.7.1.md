# archive-desk v0.7.1

Improved update downloads on unreliable networks.

- Update checks and package downloads automatically retry through GH-Proxy when GitHub cannot be reached, stalls, or returns invalid content.
- The settings page shows the active route. Package downloads prefer the route that returned a valid signed update descriptor.
- Switching routes starts a fresh download. Every attempt must pass the same signature, repository, size, SHA-256, product, and archive checks.
- Connection waits and stalled transfers have separate time limits. Cancelling an update stops further attempts.

[Windows package](https://github.com/coolminerchan/archive-desk/releases/download/v0.7.1/OverField-Capture-0.7.1-Windows-x64.zip) · [Backup download via GH-Proxy](https://gh-proxy.com/https://github.com/coolminerchan/archive-desk/releases/download/v0.7.1/OverField-Capture-0.7.1-Windows-x64.zip)

Extract the complete Windows package and run 账号采集工具.exe. Existing installations need this version before automatic fallback is available. The package includes 使用说明.txt and Capture-guide.md.

The fallback is a third-party transport for public release files. Account backups and game traffic remain local. Credits and repository links are listed in the [README](https://github.com/coolminerchan/archive-desk/blob/v0.7.1/README.md).
