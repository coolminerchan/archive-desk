"""Separate transport, undecoded tails and protocol failures without guessing causes."""


def summarize(summary, *, integrity_known, decode_failures, unknown_packets, rejected):
    records = summary.get('incomplete_streams') or []
    # Older archives may record tails only in trailing_streams. Count each
    # stream direction once per cause, even when both symptoms are present.
    gaps, tails = set(), set()
    for row in [*records, *(summary.get('trailing_streams') or [])]:
        key = (row.get('stream_id'), row.get('direction'))
        if row.get('tcp_gap'):
            gaps.add(key)
        if row.get('trailing_bytes', row.get('remaining_bytes', 0)):
            tails.add(key)
    return dict(integrity_known=integrity_known,
                tcp_gap_directions=len(gaps) if integrity_known else None,
                tail_directions=len(tails) if integrity_known else None,
                incomplete_directions=len(gaps | tails) if integrity_known else None,
                decode_failures=decode_failures, unknown_protocol_packets=unknown_packets,
                rejected_responses=rejected,
                counting_unit='unique_tcp_stream_direction_per_cause')
