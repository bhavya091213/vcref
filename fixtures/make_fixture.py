"""Regenerate fixtures/tiny.vcref (needs vcref[audio]). Deterministic: two short sine clips, rules, cadence, one part."""
from pathlib import Path

import numpy as np

import vcref


def tone(hz, secs=0.5, sr=16000):
    t = np.arange(int(sr * secs)) / sr
    return (0.3 * np.sin(2 * np.pi * hz * t)).astype(np.float32), sr


out = Path(__file__).parent / "tiny.vcref"
vcref.pack(
    out,
    {"neutral": {"audio": tone(220), "text": "This is the neutral clip.", "label": "Neutral"},
     "question": {"audio": tone(330), "text": "Is this the question clip?", "label": "Question", "source": "test"}},
    name="tiny", rules=[{"pattern": r"\?\s*$", "tag": "question"}], config={"engine": "voxcpm", "lufs": -16},
    cadence={"v": 1, "global": {"artic": 5.6, "pauses": {"comma": {"n": 3, "med": 0.36, "p90": 0.5}}}},
    parts={"A": {"audio": tone(110, 1.0)}})
print("wrote", out, out.stat().st_size, "bytes")
with vcref.Bundle(out) as b:
    (out.parent / "tiny.id").write_text(b.id + chr(10))
