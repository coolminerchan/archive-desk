# archive-desk v0.7.7

This maintenance release improves update preparation and installation on Windows.

- Valid short directory names, including Windows 8.3 aliases, are accepted alongside their long paths.
- Update paths are checked before aliases are resolved. Symbolic links, junctions, overlapping directories, and paths outside the current transaction remain rejected.
- Cancelling package preparation is respected before and after extraction. Earlier prepared updates remain available, and cleanup is limited to the current unfinished package when its path can be verified.
- Prepared-update records and helper handoffs receive additional validation. Release signatures, file checksums, the existing application entry, and rollback remain part of the update process.

Account capture, archive formats, and recorded progress handling are unchanged.

## Updating

Use the update action in Settings, or download the complete Windows x64 package. If an older installation cannot apply the update, finish any recording, close the application, and extract the full package into a new writable directory. Keep the previous program folder and account archives until the new copy has been checked. Existing settings and backups remain associated with the Windows user.

The Windows package includes 使用说明.txt and Capture-guide.md. Keep its runtime, resources, licenses, and documentation together.

The package reuses the unchanged native Win32/WebView2 host and bundled runtimes from v0.7.6. The source archive includes the application source, component notices, and matching build inputs.

Thanks to the original authors and community contributors listed in the [README](README.md).
