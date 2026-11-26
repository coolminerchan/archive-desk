"""Keep the public login UID separate from protocol player and garden IDs."""
from collections import defaultdict


class AccountIdentityIndex:
    def __init__(self):
        self.labels = defaultdict(set)

    def add(self, player_id, player_label=None):
        internal = int(player_id or 0)
        if internal <= 0:
            return
        labels = self.labels[internal]
        public = int(player_label or 0)
        if public > 0:
            labels.add(public)

    def records(self):
        result = []
        for internal, values in sorted(self.labels.items()):
            labels = sorted(values)
            uid = labels[0] if len(labels) == 1 else None
            result.append(dict(player_id=internal, player_label=uid, uid=uid,
                               uid_source='player_label' if uid else 'conflicting_labels' if labels else 'not_returned',
                               observed_player_labels=labels))
        return result

    def single(self):
        records = self.records()
        return records[0] if len(records) == 1 and records[0]['uid_source'] != 'conflicting_labels' else None

    def metadata(self):
        records = self.records()
        single = self.single()
        internal = sorted(self.labels)
        return dict(identity_schema_version=1, account_uid=single['uid'] if single else None,
                    account_uids=sorted({uid for values in self.labels.values() for uid in values}),
                    protocol_player_ids=internal, account_identities=records,
                    # Existing importers validate this legacy field against
                    # PlayerMainDataRsp.player_id, so its meaning is preserved.
                    player_uids=internal, player_uids_kind='protocol_player_id')

    def filename_key(self):
        single = self.single()
        if not single:
            return None
        return str(single['uid']) if single['uid'] else 'internal_' + str(single['player_id'])
