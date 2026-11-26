# 0.6.0

- Added an own-scenes view with per-scene snapshot counts and object summaries. Distinct snapshots remain separate and can be exported as a scene archive.
- Added support for garden directories and nested garden ZIPs inside account archives, including legacy layout and scene indexes.
- Added validated exports with ownership checks, SHA-256 verification, temporary-file delivery, and replacement only after validation succeeds.
- Expanded preflight checks to cover package completeness, protocol resources, output access, and available space.
- Added independent update checks and signed package downloads. Verified updates run from a separate directory, leaving the previous version available for rollback.
- Separated the collector's desktop entry point from the other applications.
- Improved error messages and retained detailed errors in local logs. Allowed additional time for Windows recording components to initialize on a cold start.

Account archives, own scenes, and visited-home collections remain distinct outputs. Scene and furniture counts describe observed data and do not establish coverage of unloaded areas.

The version number applies to the collector only. The other applications have separate release schedules.
