"""Display names and explicit resource mappings; never infer completion."""
import json
from pathlib import Path

CATALOG = json.loads(Path(__file__).with_name('scene_catalog.json').read_text(encoding='utf-8'))


def scene_metadata(scene_id):
    row = CATALOG['scenes'].get(str(scene_id), {})
    name = row.get('name')
    return dict(scene_name=name or f'未命名场景 {scene_id}', scene_name_known=bool(name),
                scene_category=row.get('category') or '未标注')
