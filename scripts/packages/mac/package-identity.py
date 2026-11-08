"""CI 身份记录只随 artifact 保存；从最终 ZIP 读取，不另建一份发行包。"""

import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import re
import zipfile


def main():
    parser = argparse.ArgumentParser()
    for name in ("zip", "version", "commit", "out"):
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    package = Path(args.zip)
    info_path = "Plasticine.app/Contents/Info.plist"
    server_path = "Plasticine.app/Contents/Resources/server/manifest.json"
    with zipfile.ZipFile(package) as archive:
        for name in (info_path, server_path):
            if archive.namelist().count(name) != 1:
                raise SystemExit(f"ZIP 中必须恰有一份 {name}")
        info = plistlib.loads(archive.read(info_path))
        server = json.loads(archive.read(server_path))
    if not re.fullmatch(r"[0-9a-f]{40}", args.commit) or server.get("commit") != args.commit:
        raise SystemExit("ZIP 内服务包的 commit 和构建请求不一致")
    if (not re.fullmatch(r"[0-9]{4}\.[0-9]{3,4}\.[0-9]{5,6}", args.version)
            or server.get("version") != args.version):
        raise SystemExit("ZIP 内服务版本和共用服务包不一致")
    app_version = info.get("CFBundleShortVersionString", "")
    if not isinstance(app_version, str) or not re.fullmatch(r"[0-9]+(\.[0-9]+){0,3}", app_version):
        raise SystemExit("ZIP 内 CFBundleShortVersionString 必须是点分数字")
    digest = hashlib.sha256()
    with package.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    identity = {"schema": 1, "version": args.version, "commit": args.commit,
                "appVersion": app_version, "releaseUrl": server.get("releaseUrl"),
                "sha256": digest.hexdigest(), "size": package.stat().st_size}
    Path(args.out).write_text(json.dumps(identity, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
