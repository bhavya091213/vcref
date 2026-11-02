import io
import tempfile
import unittest
import zipfile
from pathlib import Path

import vcref

FIX = Path(__file__).resolve().parents[2] / "fixtures" / "tiny.vcref"


class FixtureTests(unittest.TestCase):
    def test_reads_shared_fixture(self):
        with vcref.Bundle(FIX) as b:
            self.assertEqual((b.name, b.default), ("tiny", "neutral"))
            self.assertEqual(b.tags, ["neutral", "question"])
            self.assertEqual(b.parts, ["A"])
            self.assertEqual(b.config["lufs"], -16)
            self.assertEqual(b.cadence["global"]["artic"], 5.6)
            self.assertTrue(b.verify())
            self.assertEqual(len(b.id), 12)

    def test_rules_and_fallback(self):
        with vcref.Bundle(FIX) as b:
            self.assertEqual(b.select_tag("Really?"), "question")
            self.assertEqual(b.select_tag("Plain."), "neutral")
            self.assertEqual(b.clip("nope").tag, "neutral")

    def test_clip_bytes_are_flac(self):
        with vcref.Bundle(FIX) as b:
            c = b.clip("question")
            self.assertEqual(c.flac[:4], b"fLaC")
            self.assertEqual(c.sample_rate, 16000)
            x, sr = b.read("question")
            self.assertEqual(sr, 16000)
            self.assertAlmostEqual(len(x) / sr, 0.5, places=2)


class RoundTripTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_pack_from_flac_bytes_and_unpack(self):
        with vcref.Bundle(FIX) as src:
            flac = src.clip("neutral").flac
        out = vcref.pack(self.tmp / "a.vcref", {"neutral": {"flac": flac, "text": "hello"}})
        with vcref.Bundle(out) as b:
            self.assertTrue(b.verify())
            self.assertEqual(b.clip().flac, flac)
            d = b.unpack(self.tmp / "u")
        self.assertEqual((d / "neutral.txt").read_text(encoding="utf-8"), "hello")
        self.assertEqual((d / "neutral.flac").read_bytes(), flac)

    def test_set_cadence_keeps_audio(self):
        import shutil
        p = self.tmp / "c.vcref"
        shutil.copy(FIX, p)
        with vcref.Bundle(p) as b:
            before = b.clip("neutral").flac, b.id
        vcref.set_cadence(p, {"v": 1, "global": {"artic": 4.0}})
        with vcref.Bundle(p) as b:
            self.assertEqual((b.clip("neutral").flac, b.id), before)
            self.assertEqual(b.cadence["global"]["artic"], 4.0)

    def test_pack_validation(self):
        with self.assertRaises(vcref.VcrefError):
            vcref.pack(self.tmp / "x.vcref", {})
        with self.assertRaises(vcref.VcrefError):
            vcref.pack(self.tmp / "x.vcref", {"bad tag": {"flac": b"fLaC", "text": "t"}})


class RejectTests(unittest.TestCase):
    def test_bad_magic(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("manifest.json", "{}")
        with self.assertRaises(vcref.VcrefError):
            vcref.Bundle(buf.getvalue())

    def test_not_a_zip(self):
        with self.assertRaises(vcref.VcrefError):
            vcref.Bundle(b"nope")

    def test_corruption_detected(self):
        data = bytearray(FIX.read_bytes())
        i = data.index(b"fLaC") + 60
        data[i] ^= 0xFF
        with vcref.Bundle(bytes(data)) as b:
            with self.assertRaises(vcref.VcrefError):
                b.verify()

    def test_future_version_refused(self):
        import json
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.comment = vcref.MAGIC
            z.writestr("manifest.json", json.dumps({"format": "vcref", "version": 99, "default": "a", "clips": {"a": {}}}))
        with self.assertRaises(vcref.VcrefError):
            vcref.Bundle(buf.getvalue())


if __name__ == "__main__":
    unittest.main()
