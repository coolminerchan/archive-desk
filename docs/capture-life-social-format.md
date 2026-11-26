# Life and social capture format

Added in collector 0.7.0. These records preserve observed data; the collector does not create accounts, homes, or social relationships in a server database.

## Files

- Existing raw and JSON response files remain at the archive root.
- Raw/JSON requests are included only for GetOneTypeLifePictorialBookCountReq (1365) and FriendReq (1739). Login requests remain excluded.
- packet-context.json records the original headers for those requests, their responses (1366 and 1740), and GetLifeInfoRsp (1370).
- life-social.json contains the complete classification report. life-social.txt is its readable summary.
- capture-report.json contains a bounded display summary. Use life-social.json and the raw files for restoration.

## Header context

packet-context.json has schema_version 1, kind packet_context, a 32-character capture_scope, and a records array. Each record contains:

| Field | Meaning |
| --- | --- |
| source | Relative raw/*.bin path |
| message / msg_id | Protocol name and numeric command ID |
| stream_id | TCP connection index within this recording |
| connection_id | capture_scope followed by :s and stream_id |
| direction | c2s for requests, s2c for responses |
| packet_id / seq_id | Original PacketHead values; response seq_id need not equal request seq_id |
| body_sha256 | Digest of the exported protocol body |
| request_fields | life_type for 1365, type for 1739; null for responses |
| connection_incomplete | The parser observed a gap or undecoded tail on this connection |
| decode_error | The body could not be decoded reliably |

Raw bodies and header context must agree. Validate the source, digest, direction, message family, and request field before using a classification. Context is recorded evidence, not a fresh account authentication.

Match by connection_id, packet_id, and request/response family. Only one request and one response may match. A zero PacketId, duplicate candidates, missing counterpart, incomplete connection, or unreadable body leaves the response unclassified. Never infer a class from arrival order, a neighboring response, or an equal PacketId on another connection.

## Life records

The base section groups successful GetLifeInfoRsp records by their explicit life_type. Base, skill, and achievement sections are retained separately; inconsistent life types are not assigned. A partial base response does not establish full base coverage.

The history section matches 1365 to 1366 and records each successful response under the request's life_type. Types 1 through 6 are cooking, fishing, making, handicraft, sewing, and gathering.

Each snapshot contains request and response context, status, entry_count, and counts. Counts are an ordered list of id/count records. The count field is a decimal string to preserve uint64 values. Duplicate observations are separate snapshots and must not be summed. Do not derive production history from achievement thresholds or current inventory quantities.

## Social records

The social section matches FriendReq to FriendRsp. Request types are:

| Type | Category |
| --- | --- |
| 0 | Default list; retained separately, with no inferred social meaning |
| 1 | Applications |
| 2 | Friends |
| 3 | Blacklist |

Every snapshot retains its request and response references, status, and entry_count. Complete player information remains in the referenced original FriendRsp body. A successful empty response establishes an empty list for that request type; an unclassified or failed response does not.

Multiple snapshots retain their own contents. The display may show the observation with the most entries, but it is not a final-state selection policy for an importer.

Relationship restoration requires independent validation of both players' local UID mappings. Unmigrated players remain captured profile data. They must not become fabricated local accounts or homes. This collector performs no relationship restoration.

## Quality and compatibility

The quality items are life_base, life_history, and social_lists. They separately count the six base categories, six history categories, and three required social categories (1, 2, 3). Coverage means those categories have usable evidence, not that all account data or the final state has been proven complete.

A single captured account is required for attributed coverage. Unpaired and failed records remain visible in the report. Missing pages remain unknown. Successful empty lists are distinct from missing responses.

Older ZIPs may contain response bodies without header context. Keep those responses, but leave their list classification unknown. Reanalyzing an original PCAP can recover classifications if the corresponding requests and headers were captured. Missing 1366 responses require a supplemental capture of the relevant profession's pictorial page. Existing base records do not need recapture to address the server-side missing route.
