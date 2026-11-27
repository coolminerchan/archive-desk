# Capture sources

The parser, Wi-Fi compatibility layer and exploration report are derived from
[inori-dream/miaomiao-launcher](https://github.com/inori-dream/miaomiao-launcher)
at `6a2816ded52a4a3c1f5ab9b3768f6e048f409f6f` (collector 1.0.12 integration).
The continuous live checklist starts from our previously submitted continuous
capture fix at `fcd3cb8`. Original component notices remain in the bundled
capture-toolkit/THIRD-PARTY.txt and proto_gen license files.

Local changes select dependencies explicitly, infer dynamic-port direction from
request/response roles, stop reassembly at TCP gaps, bound decompression and live
scans, retain equipment partial states, inspect transformed and extra items,
exclude gacha history from required checks, and read snapshots of a continuous
multi-file trace without restarting PktMon. Unknown evidence remains unknown.

0.4.1 also provides map-specific live guidance and includes exploration.txt in
the account ZIP. SceneDataNotice legitimately uses StatusCode_NONE (0); local
exploration handling accepts that notice status as well as OK, while responses
still require OK. Garden scene notices are excluded before adding world-map
evidence. Regression coverage verifies crystals, boxes, moons, map isolation,
and the same evidence in the live observer and final ZIP.

0.5.1 corrects empty garden submessages serialized in ordinary world scenes:
field presence alone no longer makes a world channel a garden owner or moves
its scene packets out of the account archive. Filtered equipment lists followed
by a larger complete list are evaluated separately from retained push-only
items. List quantity agreement does not claim whole-account coverage. Successful
empty moon lists are distinguished from unobserved maps.

The Windows recorder uses its own temporary ETW session for the PktMon provider,
with 128 KB buffers and a one-second flush timer, while PktMon configures the
existing packet filters and driver. The file session is started before the game,
does not restart on rollover, is addressed by a generated unique name, and is
stopped cooperatively. The former buffered backend remains a compatibility
fallback. Capture-loop cleanup releases the mutex even if trace cleanup fails.
Relevant Microsoft documentation: https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/logman-create-trace
and https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/pktmon-start

0.5.2 adds account_identity.py to keep public login UIDs (player_label) separate
from internal protocol player_id values. Reports, live display and account ZIP
names use the observed public UID; raw responses and garden ownership keys keep
their original IDs. Legacy summary.player_uids remains a list of protocol IDs
for importer compatibility, with explicit metadata describing both identities.
Absent labels stay unknown; contradictory labels prevent single-account export.

The surrounding CaptureController, capture_report and desktop capture-session
integration manage scoped filters, exports and recovery for the OverField tools.

0.5.3 rechecked upstream HEAD 874e53aadc1be4bb698678c110e7442e128794de
(v1.4.4, 2026-11-26) and selectively adopted the TCP marker boundary correction
from aadc62e: a marker may share a hex line with real prefix bytes. Each direction
stops independently at its first gap. The local final sequence coverage check is
retained, including out-of-order and retransmission handling.

Quality now separates unique stream directions with sequence gaps, undecoded
tail bytes, decode failures, unknown messages, unsuccessful responses, missing
categories and successful empty lists. These causes can overlap and are not
summed into a misleading packet-loss count. Timing records distinguish startup,
first readable live evidence (including flush/poll delay), conversion, reassembly
and decode/export, response audit and final archival. The extra intermediate
account ZIP is skipped by the desktop analyzer and its temporary validation ZIP
is stored without compression; final backups remain compressed and validated.
Diagnostic export uses explicit numeric allowlists and contains no account
identity, addresses, paths, request/response bodies, tokens or free-form errors.

The local dungeons.py exports per-dungeon SceneData summaries, successful
DungeonView/Enter/RepeatEnter/Finish snapshots and final-box notices. Snapshots,
task lists and entry box states remain separate; unknown total coverage is never
presented as full completion. Captured records do not unlock content or write a
database. Multi-account observations stay unattributed, and gardens are excluded.

0.5.4 adds a dedicated local garden-capture module after reviewing upstream
195a874a2b710def0f0d89c6d574353b5ea63495 (v1.4.6). Account and garden results,
sessions and delivery paths stay independent while sharing one recorder. Garden
capture can produce individually indexed layouts and a flat collection without
requiring account main data. Known own gardens are excluded; otherwise identity
uncertainty is shown. Exported numeric-owner raw/json directories can be reopened
without response-name collisions or prefix growth; legacy BIN/JSON-only layout
archives are validated without fabricating SceneDataNotice evidence. No garden
import or server/database writing is implemented by this module.

0.5.5 binds successful OtherPlayerInfoRsp.other_info.nick_name to its exact
internal player_id, including owners absent from SceneData.players. Live scans,
PCAP analysis and reopened ZIPs retain names; only minimal existing layout
metadata is used for ZIP fallback, without adding full profiles to garden ZIPs.
The recorder prefers NEWFILE | NO_PER_PROCESSOR_BUFFERING (0x10000008), using
the Windows EventTracingManagement module and retaining 128-KiB buffers and a
one-second flush. This avoids flushing a mostly empty buffer per active CPU.
Unsupported systems retain the existing per-CPU compact/backend fallback.
Console.In.ReadLineAsync is replaced with asynchronous standard-input byte IO:
the synchronized TextReader in Windows PowerShell could block the entire limit
and stop-flag loop. Account and garden limit states are independent.
Microsoft API reference for buffer semantics:
https://learn.microsoft.com/en-us/windows/win32/api/evntrace/ns-evntrace-event_trace_properties

Local 0.7.4 additions: nebula_tree.py retains successful AbilityBadgeListRsp
snapshots, keeping page-scoped active nodes, task counters and reward claims
separate. It does not use the unrelated BlessTree protocol or restore saves.
life_social.py now exposes individual skill levels and lossless study timestamps.
life_skill_catalog.json contains only verified names joined through each
profession's Spell.TextID and matching String section. Identical skill IDs in
different professions are scoped by life_type; blank resource text stays unnamed.
Per-file source SHA-256 values remain in the catalog.
