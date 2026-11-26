import json
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
source = BASE / 'product.json'
if not source.is_file():
    source = BASE / 'capture-version.json'
VERSION = json.loads(source.read_text(encoding='utf-8-sig'))['version']
