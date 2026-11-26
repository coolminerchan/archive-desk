"""Bounded, read-only access to capture ZIPs and one level of garden ZIPs."""
from contextlib import ExitStack
from io import BytesIO
from pathlib import PurePosixPath
import re
from zipfile import ZipFile

MAX_ENTRIES = 50000
MAX_TOTAL = 512 << 20
MAX_MEMBER = 32 << 20


def clean_name(value):
    path = PurePosixPath(value)
    if not value or path.is_absolute() or '..' in path.parts or '\\' in value or ':' in value or '\x00' in value:
        raise ValueError('ZIP 含无效路径')
    return path.as_posix()


def strip_export(value):
    return value[7:] if value.startswith('export/') else value


def garden_owner(value):
    parts = PurePosixPath(strip_export(value)).parts
    if len(parts) >= 2 and parts[0].isdigit():
        return int(parts[0])
    if len(parts) >= 3 and parts[0] == 'gardens' and parts[1].isdigit():
        return int(parts[1])
    return None


class ArchiveView:
    def __init__(self, path, *, nested_gardens=False, crc=False):
        self.path, self.nested_gardens, self.crc = path, nested_gardens, crc
        self.stack = ExitStack()
        self.members = {}
        self.total = self.entries = 0

    def __enter__(self):
        try:
            root = self.stack.enter_context(ZipFile(self.path))
            self._add(root)
            if self.nested_gardens:
                for name, (archive, info) in list(self.members.items()):
                    relative = strip_export(name)
                    match = re.fullmatch(r'gardens/garden_.+_(\d+)\.zip', relative)
                    if not match:
                        continue
                    owner = int(match[1])
                    if not 0 < owner <= 0xffffffff:
                        raise ValueError('装修包屋主编号无效')
                    raw = self.read(name)
                    inner = self.stack.enter_context(ZipFile(BytesIO(raw)))
                    self._add(inner, owner=owner)
            return self
        except Exception:
            self.stack.close()
            raise

    def _add(self, archive, owner=None):
        seen = set()
        for info in archive.infolist():
            self.entries += 1
            if self.entries > MAX_ENTRIES:
                raise ValueError('ZIP 文件条目过多')
            name = clean_name(info.orig_filename)
            if name in seen:
                raise ValueError('ZIP 含重复文件')
            seen.add(name)
            if info.is_dir():
                continue
            if info.flag_bits & 1 or (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('ZIP 不支持加密文件或符号链接')
            self.total += info.file_size
            if self.total > MAX_TOTAL:
                raise ValueError('ZIP 解压内容超过处理上限')
            name = strip_export(name)
            if owner is not None:
                declared = garden_owner(name)
                if declared is not None:
                    if declared != owner:
                        raise ValueError('嵌套装修包的屋主编号不一致')
                    parts = PurePosixPath(name).parts
                    name = '/'.join(parts[2:] if parts[0] == 'gardens' else parts[1:])
                name = f'gardens/{owner}/{name}'
            if name in self.members:
                if owner is not None and info.file_size <= MAX_MEMBER and self.read(name) == archive.read(info):
                    continue
                raise ValueError('ZIP 含重复的归档内容')
            if self.crc:
                # Stream the CRC check rather than loading every member in RAM.
                with archive.open(info) as stream:
                    while stream.read(1 << 20):
                        pass
            self.members[name] = (archive, info)

    def read(self, name, limit=MAX_MEMBER):
        archive, info = self.members[name]
        if info.file_size > limit:
            raise ValueError('ZIP 文件超过读取上限')
        return archive.read(info)

    def __exit__(self, *args):
        return self.stack.__exit__(*args)
