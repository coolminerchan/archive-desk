"""Archive the portable Windows application without user settings or session data."""

from pathlib import Path
import sys
from zipfile import ZIP_DEFLATED, ZipFile

root, output = map(Path, sys.argv[1:])
with ZipFile(output, "x", compression=ZIP_DEFLATED, compresslevel=4) as archive:
    for path in sorted(root.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(root.parent))
