"""The .vcref container. Standard library only; decoding audio to arrays needs the optional `audio` extra."""
import hashlib
import io
import json
import re
import struct
import time
import zipfile
from collections import namedtuple
from pathlib import Path

MAGIC = b"VCREF1"
VERSION = 1
_TAG = re.compile(r"^[A-Za-z0-9_-]+$")

Clip = namedtuple("Clip", "tag text seconds label sample_rate flac")


class VcrefError(Exception):
    pass


def _sha(b):
    return hashlib.sha256(b).hexdigest()


def _check_tag(tag):
    if not _TAG.match(tag):
        raise VcrefError(f"bad tag {tag!r}: use letters, digits, '_' or '-'")


def _soundfile():
    try:
        import soundfile as sf
    except ImportError:
        raise VcrefError("this needs the audio extra: pip install 'vcref[audio]'")
    return sf


def _flac_rate(data):
    if data[:4] != b"fLaC":
        raise VcrefError("flac bytes do not start with 'fLaC'")
    return (struct.unpack(">I", data[18:22])[0] >> 12) & 0xFFFFF  # STREAMINFO sample rate (20 bits)


def pack(out, clips, name=None, default=None, rules=None, config=None, cadence=None, parts=None):
    """Write a bundle and return its path.

    clips  {tag: {"text": str, plus one of "flac": bytes | "wav": path | "audio": (ndarray, sr),
                  optional "label", "source"}}
           "wav"/"audio" are encoded to 24-bit FLAC (needs vcref[audio]); "flac" bytes are stored as given.
    parts  {name: same audio keys}   optional full enrollment recordings
    """
    if not clips:
        raise VcrefError("a bundle needs at least one clip")
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)

    def to_flac(spec):
        if "flac" in spec:
            data = bytes(spec["flac"])
            return data, _flac_rate(data), spec.get("seconds")
        sf = _soundfile()
        if "wav" in spec:
            x, sr = sf.read(spec["wav"], dtype="float32")
        elif "audio" in spec:
            x, sr = spec["audio"]
        else:
            raise VcrefError("each clip needs 'flac', 'wav' or 'audio'")
        buf = io.BytesIO()
        sf.write(buf, x, sr, format="FLAC", subtype="PCM_24")
        return buf.getvalue(), int(sr), round(len(x) / sr, 2)

    tmp = out.with_suffix(out.suffix + ".tmp")
    mclips, mparts = {}, {}
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
        z.comment = MAGIC
        for tag, spec in clips.items():
            _check_tag(tag)
            if not spec.get("text"):
                raise VcrefError(f"clip {tag!r} has no transcript text")
            data, sr, secs = to_flac(spec)
            z.writestr(f"clips/{tag}.flac", data)
            entry = {"file": f"clips/{tag}.flac", "text": spec["text"], "seconds": secs, "label": spec.get("label"),
                     "source": spec.get("source"), "sample_rate": sr, "sha256": _sha(data)}
            mclips[tag] = {k: v for k, v in entry.items() if v is not None}
        for pname, spec in (parts or {}).items():
            _check_tag(pname)
            data, sr, secs = to_flac(spec)
            z.writestr(f"parts/{pname}.flac", data)
            entry = {"file": f"parts/{pname}.flac", "seconds": secs, "sha256": _sha(data)}
            mparts[pname] = {k: v for k, v in entry.items() if v is not None}
        default = default or ("neutral" if "neutral" in mclips else next(iter(mclips)))
        if default not in mclips:
            raise VcrefError(f"default {default!r} is not a clip")
        for r in rules or []:
            re.compile(r["pattern"])  # fail now, not at read time
            if r["tag"] not in mclips:
                raise VcrefError(f"rule tag {r['tag']!r} is not a clip")
        manifest = {"format": "vcref", "version": VERSION, "name": name or out.stem, "created": time.strftime("%Y-%m-%d"),
                    "default": default, "clips": mclips, "rules": rules or [], "config": config or {}, "parts": mparts}
        if cadence:
            manifest["cadence"] = cadence
        z.writestr("manifest.json", json.dumps(manifest, indent=1, ensure_ascii=False))
    tmp.replace(out)
    return out


class Bundle:
    """Open a bundle from a path, bytes or a binary file object."""

    def __init__(self, source):
        if isinstance(source, (bytes, bytearray)):
            source = io.BytesIO(source)
        try:
            self._z = zipfile.ZipFile(source)
        except (zipfile.BadZipFile, FileNotFoundError) as e:
            raise VcrefError(f"not a readable vcref ({e})")
        self.path = Path(source) if isinstance(source, (str, Path)) else None
        if self._z.comment != MAGIC:
            raise VcrefError("not a vcref file (bad magic)")
        try:
            m = json.loads(self._z.read("manifest.json"))
        except (KeyError, ValueError) as e:
            raise VcrefError(f"bad manifest.json ({e})")
        if m.get("format") != "vcref" or m.get("version", 0) > VERSION:
            raise VcrefError(f"unsupported vcref version {m.get('version')}")
        if m.get("default") not in m.get("clips", {}):
            raise VcrefError("manifest default is not a clip")
        self.manifest = m

    def _read(self, name):
        try:
            return self._z.read(name)
        except KeyError:
            raise VcrefError(f"missing entry {name}")
        except zipfile.BadZipFile as e:
            raise VcrefError(f"corrupt entry {name} ({e})")

    def close(self):
        self._z.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    name = property(lambda s: s.manifest["name"])
    default = property(lambda s: s.manifest["default"])
    config = property(lambda s: s.manifest.get("config", {}))
    tags = property(lambda s: list(s.manifest["clips"]))
    parts = property(lambda s: list(s.manifest.get("parts", {})))
    cadence = property(lambda s: s.manifest.get("cadence"))

    @property
    def id(self):
        """12-hex content id: hash of the sorted clip hashes (ignores names and settings)."""
        return _sha("".join(sorted(c["sha256"] for c in self.manifest["clips"].values())).encode())[:12]

    def rules(self):
        """[(compiled regex, tag)] in order."""
        return [(re.compile(r["pattern"]), r["tag"]) for r in self.manifest.get("rules", [])]

    def select_tag(self, text):
        """The clip tag the rules choose for `text` (first match), else the default."""
        for rx, tag in self.rules():
            if rx.search(text) and tag in self.manifest["clips"]:
                return tag
        return self.default

    def clip(self, tag=None):
        """Clip for `tag` (unknown or None -> default) with its FLAC bytes."""
        if tag not in self.manifest["clips"]:
            tag = self.default
        c = self.manifest["clips"][tag]
        return Clip(tag, c["text"], c.get("seconds"), c.get("label"), c.get("sample_rate"), self._read(c["file"]))

    def part(self, name):
        """FLAC bytes of an enrollment recording."""
        return self._read(self.manifest["parts"][name]["file"])

    def read(self, tag=None):
        """(float32 ndarray, sample_rate) for a clip. Needs vcref[audio]."""
        return _soundfile().read(io.BytesIO(self.clip(tag).flac), dtype="float32")

    def verify(self):
        """Raise VcrefError on any hash mismatch or missing entry; return True otherwise."""
        for kind in ("clips", "parts"):
            for key, meta in self.manifest.get(kind, {}).items():
                data = self._read(meta["file"])
                if _sha(data) != meta["sha256"]:
                    raise VcrefError(f"{kind[:-1]} {key!r} is corrupt (hash mismatch)")
        return True

    def unpack(self, out_dir, wav=False):
        """Write <tag>.flac (or .wav with the audio extra) and <tag>.txt for every clip."""
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        for tag in self.tags:
            c = self.clip(tag)
            if wav:
                x, sr = self.read(tag)
                _soundfile().write(out_dir / f"{tag}.wav", x, sr, subtype="PCM_24")
            else:
                (out_dir / f"{tag}.flac").write_bytes(c.flac)
            (out_dir / f"{tag}.txt").write_text(c.text, encoding="utf-8")
        return out_dir


def set_cadence(path, cadence):
    """Replace the cadence block of an existing bundle; every other entry is copied byte for byte."""
    path = Path(path)
    with Bundle(path) as b:
        m = dict(b.manifest)
        m["cadence"] = cadence
        tmp = path.with_suffix(path.suffix + ".tmp")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
            z.comment = MAGIC
            for n in b._z.namelist():
                if n != "manifest.json":
                    z.writestr(n, b._z.read(n))
            z.writestr("manifest.json", json.dumps(m, indent=1, ensure_ascii=False))
    tmp.replace(path)
    return path
