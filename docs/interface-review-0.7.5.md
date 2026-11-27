# Interface review: 0.7.5

The previous capture screen mixed recording controls, browsing instructions, saved account data, evidence tables, timing measurements, and recovery options. Users had to interpret all of these before deciding what to do next.

## Main tasks

| Task | Destination | Default view |
| --- | --- | --- |
| Start or finish an account recording | Account backup | Main action, three-step outline, current next step or latest account |
| Inspect saved content | Saved records | One category at a time: equipment, maps, tree, life, social, dungeons, scenes |
| Collect visited home decoration | Home decoration | Start/stop, recorded homes, collection export |
| Configure or troubleshoot | Settings | Game path, save folder, update, recovery and environment check |

## Disclosure rules

- Only the action relevant to the recording stage is emphasized. Stopping is disabled during finalization. Empty recordings retain their explanation and do not claim an account was saved.
- Completed categories do not become missing because an optional history list is absent. Partial categories are not counted as received. Unknown evidence remains separate from confirmed missing responses.
- Default account results show the account identity and preserved equipment counts. Checklist details, source IDs, protocol counts, timestamps and diagnostics are available without dominating the main screen.
- Profession cards show the profession level first, then individual skill levels on expansion. Missing skill detail in an older report requests reanalysis; successful empty lists remain distinct.
- Reference-only scenes and unverified totals stay inside map details. The main map view does not present an inferred completion percentage.
- Category tabs support arrow keys, Home and End, with visible focus. Disclosure controls retain native keyboard and accessibility behavior. Text is larger and the layout uses a consistent spacing and color hierarchy.

## Validation

Native WebView2 checks cover empty, loaded, recording, saving, error and legacy-report states, all record categories, the garden page, settings, keyboard navigation, canceling file selection and verified account export. Recording, saving and error display checks use an isolated UI-state fixture; they do not start a live recording. Real archives remain the source for saved-data checks.

Capture, import, archive formats, update verification and original-data handling are unchanged.
