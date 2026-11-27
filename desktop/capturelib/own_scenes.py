"""Own-channel snapshot indexes. Never merge different snapshots into one layout."""
from collections import defaultdict
import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile, ZIP_DEFLATED

from archive_files import ArchiveView
from scene_metadata import scene_metadata


def positive_id(value):
    return type(value) is int and 0 < value <= 0xffffffff


def belongs(scene, identity):
    if scene.channel_id:
        return scene.channel_id == identity['player_id']
    return bool(identity.get('uid') and scene.channel_label == identity['uid'])


class OwnScenes:
    def __init__(self, proto, output):
        self.proto, self.output = proto, Path(output)
        self.records = {}
        self.declared = None

    def add(self, scene, source, *, notice=True):
        if not scene.scene_id or not (scene.channel_id or scene.channel_label):
            return
        raw = scene.SerializeToString(deterministic=True)
        digest = hashlib.sha256(raw).hexdigest()
        key = (int(scene.scene_id), digest)
        if key in self.records:
            self.records[key]['observations'] += 1
            return
        counts = {key: len(getattr(scene, field)) for key, field in (
            ('placed_characters', 'placed_characters'), ('room_decor', 'room_decor_list'),
            ('vehicles', 'vehicle_info_list'), ('chairs', 'chair_info_list'),
            ('camp_fires', 'camp_fires'), ('bon_fires', 'bon_fires'),
            ('treasure_boxes', 'treasure_boxes'), ('areas', 'areas'))}
        counts['garden_furniture'] = len(scene.scene_garden_data.garden_furniture_info_map)
        self.records[key] = dict(scene_id=int(scene.scene_id), channel_id=int(scene.channel_id),
            channel_label=int(scene.channel_label), digest=digest, bytes=len(raw),
            source=source, notice=notice, observations=1, tod_time=int(scene.tod_time), **counts)

    def load_archive(self, path, identity=None):
        """Accept typed indexes and original bare SceneData, not fabricated notices."""
        with ArchiveView(path) as archive:
            index_name = next((n for n in ('own-scenes/index.json', 'my-scenes/index.json', 'index.json') if n in archive.members), None)
            if index_name is None:
                return
            index = json.loads(archive.read(index_name, 2 << 20).decode('utf-8-sig'))
            if not isinstance(index, dict) or not isinstance(index.get('scenes'), list):
                raise ValueError('场景索引格式无效')
            modern = index.get('kind') == 'own_scene_collection'
            declared = index.get('identity') if modern else dict(player_id=index.get('owner_uid'), uid=None)
            if not isinstance(declared, dict) or not positive_id(declared.get('player_id')) or (declared.get('uid') is not None and not positive_id(declared['uid'])):
                raise ValueError('场景索引缺少有效归属')
            declared = {key: declared.get(key) for key in ('player_id', 'uid')}
            if identity and declared['player_id'] != identity['player_id']:
                raise ValueError('场景索引与账号归属不一致')
            if identity and identity.get('uid') and declared.get('uid') not in (None, identity['uid']):
                raise ValueError('场景索引与登录标识不一致')
            if self.declared and self.declared != declared:
                raise ValueError('场景包含多个归属')
            self.declared = declared
            rows = index.get('snapshots', []) if modern else index['scenes']
            if not isinstance(rows, list) or len(rows) > 10000:
                raise ValueError('场景索引超过处理上限')
            parent = PurePosixPath(index_name).parent
            for row in rows:
                if not isinstance(row, dict):
                    raise ValueError('场景索引条目无效')
                source = row.get('source') if modern else str(parent / str(row.get('bin_file', '')))
                if not isinstance(source, str) or source not in archive.members:
                    raise ValueError('场景索引引用的文件不存在')
                raw = archive.read(source)
                if not positive_id(row.get('scene_id')) or (modern and type(row.get('notice')) is not bool):
                    raise ValueError('场景索引字段无效')
                notice = bool(row.get('notice')) if modern else False
                scene = self.proto.SceneDataNotice.FromString(raw).data if notice else self.proto.SceneData.FromString(raw)
                if scene.scene_id != row.get('scene_id') or not belongs(scene, identity or declared):
                    raise ValueError('场景文件与索引归属不一致')
                digest = hashlib.sha256(scene.SerializeToString(deterministic=True)).hexdigest()
                if (int(scene.scene_id), digest) in self.records:
                    continue
                # Root response files are already kept by the ordinary reader.
                # Bare scene archives get their own typed storage directory.
                if modern and notice and (self.output / source).is_file():
                    self.add(scene, source)
                    continue
                target = f'own-scenes/data/scene_{scene.scene_id}_{digest}.bin'
                file = self.output / target
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(scene.SerializeToString())
                self.add(scene, target, notice=False)

    def export(self, identity=None, *, allow_declared=False):
        identity = identity or (self.declared if allow_declared else None)
        empty = dict(scene_count=0, snapshot_count=0, scenes=[], bundle=None, identity=None)
        if identity is None:
            return empty
        chosen = []
        for row in self.records.values():
            if row['channel_id'] == identity['player_id'] or (not row['channel_id'] and identity.get('uid') and row['channel_label'] == identity['uid']):
                chosen.append(row)
        if not chosen:
            return empty
        # Make the index independent of later raw-response separation. Every
        # indexed file is bare SceneData, explicitly typed in the index.
        stable = []
        for row in chosen:
            raw = (self.output / row['source']).read_bytes()
            scene = self.proto.SceneDataNotice.FromString(raw).data if row['notice'] else self.proto.SceneData.FromString(raw)
            source = f"own-scenes/data/scene_{row['scene_id']}_{row['digest']}.bin"
            target = self.output / source
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(scene.SerializeToString())
            stable.append(dict(row, source=source, notice=False))
        chosen = stable
        groups = defaultdict(list)
        for row in chosen:
            groups[row['scene_id']].append(row)
        scenes = []
        for scene_id, rows in sorted(groups.items()):
            selected = max(rows, key=lambda row: row['bytes'])
            scenes.append(dict(selected, **scene_metadata(scene_id), snapshots=len(rows), observations=sum(r['observations'] for r in rows)))
        identity = dict(player_id=identity['player_id'], uid=identity.get('uid'))
        index = dict(schema_version=1, kind='own_scene_collection', identity=identity,
            identity_source='main_response' if not allow_declared else 'archive_metadata',
            scene_count=len(scenes), snapshot_count=len(chosen), scenes=scenes, snapshots=chosen)
        directory = self.output / 'own-scenes'
        directory.mkdir(exist_ok=True)
        (directory / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding='utf-8')
        bundle = self.output / 'own_scenes_all.zip'
        from google.protobuf.json_format import MessageToDict
        with ZipFile(bundle, 'w', ZIP_DEFLATED) as archive:
            packed = []
            for row in chosen:
                raw = (self.output / row['source']).read_bytes()
                scene = self.proto.SceneDataNotice.FromString(raw).data if row['notice'] else self.proto.SceneData.FromString(raw)
                stem = f"own-scenes/data/scene_{row['scene_id']}_{row['digest']}"
                archive.writestr(stem + '.bin', scene.SerializeToString())
                archive.writestr(stem + '.json', json.dumps(MessageToDict(scene, preserving_proto_field_name=True), ensure_ascii=False))
                packed.append(dict(row, source=stem + '.bin', notice=False))
            archive.writestr('own-scenes/index.json', json.dumps(dict(index, snapshots=packed), ensure_ascii=False))
        return dict(index, bundle=str(bundle))
