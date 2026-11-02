import argparse
import sys

from .bundle import Bundle, VcrefError


def main(argv=None):
    ap = argparse.ArgumentParser(prog="vcref", description="Inspect and check .vcref voice bundles")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for n in ("info", "verify"):
        sub.add_parser(n).add_argument("file")
    u = sub.add_parser("unpack")
    u.add_argument("file")
    u.add_argument("dir")
    u.add_argument("--wav", action="store_true", help="decode to 24-bit WAV (needs vcref[audio])")
    a = ap.parse_args(argv)
    try:
        with Bundle(a.file) as b:
            if a.cmd == "info":
                print(f"{b.name}  id={b.id}  default={b.default}  rules={len(b.manifest.get('rules', []))}  "
                      f"parts={len(b.parts)}  cadence={'yes' if b.cadence else 'no'}")
                for t, c in b.manifest["clips"].items():
                    print(f"  {t:12} {c.get('seconds') or 0:6.1f}s {c.get('sample_rate') or 0:>6} Hz  {c['text'][:60]}")
            elif a.cmd == "verify":
                b.verify()
                print("ok")
            else:
                print(b.unpack(a.dir, wav=a.wav))
    except VcrefError as e:
        sys.exit(f"vcref: {e}")


if __name__ == "__main__":
    main()
