# archive-desk v0.7.2

Fixed updates leaving the original application entry on an older version.

- “Update and restart” replaces the program files in the existing installation after the application closes. The original EXE path and desktop shortcuts remain valid.
- An independent helper verifies the staged files, records each replacement, and keeps the previous program components for rollback.
- Failed replacements restore the previous version. Interrupted transactions recover before the UI starts.
- A verified handoff from an older updater can finish installation at the original location instead of leaving the new version only in the update cache.
- Direct and fallback downloads continue to require the release signature, size, SHA-256, product, and archive checks.

[Windows package](https://github.com/coolminerchan/archive-desk/releases/download/v0.7.2/OverField-Capture-0.7.2-Windows-x64.zip) · [Backup download](https://gh-proxy.com/https://github.com/coolminerchan/archive-desk/releases/download/v0.7.2/OverField-Capture-0.7.2-Windows-x64.zip)

Extract the complete package for a manual installation. Package instructions describe automatic updates and the retained program backup. Settings and account archives remain in their existing locations. Credits and repository links are listed in the [README](https://github.com/coolminerchan/archive-desk/blob/v0.7.2/README.md).
