# archive-desk v0.7.3

Added scene names and clearer world-progress evidence.

- Scene tables display Chinese names joined from the client resource tables. The reference covers 156 scene IDs; one blank resource name remains unnamed.
- Scenic spots, timed challenges, world challenges, and the account's own challenge times are reported separately.
- Activity observations are retained in world-activities.json and the original protocol files. Repeated global histories are counted by distinct ID without assigning every entry to its container scene.
- Unlock flags do not substitute for scenic completion. A timed challenge's Start state or a recorded time alone does not become an “unfinished” verdict.
- Older cached reports can display verified scene names without a new capture. Equipment and capture-quality messages identify the actual missing information instead of a generic review warning.
- Exploration snapshots and garden decoration snapshots have separate tables. Scene 6 includes an explanation of its unnamed night-scene resource and its absence from the current world configuration.
- All eight browsing-guide steps use distinct in-game portraits, including life and social steps.

This release updates capture and inspection. Server-side restoration still needs to return the captured completion fields; this collector does not modify game saves.

The complete package includes 使用说明.txt, Capture-guide.md, and docs/scene-reference.md. Credits and repository links are listed in the README.
