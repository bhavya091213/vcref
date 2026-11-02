# vcref (Python)

Read, write and verify `.vcref` voice reference bundles. Format: [SPEC.md](https://github.com/bhavya091213/vcref/blob/main/SPEC.md).

```
pip install vcref            # no dependencies
pip install "vcref[audio]"   # + soundfile/numpy: decode clips to arrays, pack from WAV/ndarray
```

```python
import vcref

with vcref.Bundle("dean.vcref") as b:          # path, bytes or file object
    b.name, b.default, b.tags, b.config, b.cadence, b.id
    b.verify()                                  # SHA-256 of every clip and part
    tag = b.select_tag("Really?")               # first matching rule, else the default
    clip = b.clip(tag)                          # Clip(tag, text, seconds, label, sample_rate, flac)
    audio, sr = b.read(tag)                     # float32 array (needs the audio extra)
    b.unpack("out/")                            # <tag>.flac + <tag>.txt (wav=True for WAV)

vcref.pack("voice.vcref",
           {"neutral": {"wav": "neutral.wav", "text": "What is said in the clip."},
            "question": {"flac": flac_bytes, "text": "Is it?"}},
           name="voice", rules=[{"pattern": r"\?\s*$", "tag": "question"}], config={"engine": "voxcpm"})

vcref.set_cadence("voice.vcref", cadence_dict)  # rewrite only the cadence block
```

Errors are `vcref.VcrefError`. Command line: `vcref info|verify <file>`, `vcref unpack <file> <dir> [--wav]`.
