#!/usr/bin/env python3
import argparse
import os
import zipfile


def iter_files(root_dir: str):
    for base, dirs, files in os.walk(root_dir):
        dirs.sort()
        files.sort()
        for name in files:
            p = os.path.join(base, name)
            rel = os.path.relpath(p, root_dir)
            yield p, rel


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    src = os.path.abspath(args.src)
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)

    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for abs_path, rel_path in iter_files(src):
            z.write(abs_path, rel_path)


if __name__ == "__main__":
    main()

