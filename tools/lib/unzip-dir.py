#!/usr/bin/env python3
import argparse
import os
import zipfile


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="out", required=True)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    with zipfile.ZipFile(args.src, "r") as z:
        z.extractall(args.out)


if __name__ == "__main__":
    main()

