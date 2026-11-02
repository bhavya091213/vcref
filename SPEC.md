# The .vcref format, version 1

A `.vcref` file is a portable voice reference bundle: every reference clip of one voice (for example one per
intonation), each with its transcript, plus default settings, rules that choose a clip for a piece of text, and
optional speaking-cadence measurements. It is meant to be read by any zero-shot voice-cloning TTS pipeline.

## Container

A ZIP archive whose **archive comment is exactly the 6 bytes `VCREF1`**. Writers SHOULD use method 0 (stored): the audio
is already compressed FLAC. Readers MUST also accept method 8 (deflate). ZIP64 is not required.

| Entry | Required | Content |
|---|---|---|
| `manifest.json` | yes | UTF-8 JSON, see below |
| `clips/<tag>.flac` | one per manifest clip | the clip, FLAC (24-bit recommended), any sample rate |
| `parts/<name>.flac` | no | full enrollment recordings, referenced by `manifest.parts` |

Tags and part names match `[A-Za-z0-9_-]+`. Entry names use `/`.

## manifest.json

```json
{
  "format": "vcref",
  "version": 1,
  "name": "dean",
  "created": "2026-10-28",
  "default": "neutral",
  "clips": {
    "neutral": {"file": "clips/neutral.flac", "text": "Transcript of the clip.", "seconds": 11.4,
                "label": "Dean, clip 1", "source": "video", "sample_rate": 48000,
                "sha256": "<hex sha-256 of the FLAC bytes>"}
  },
  "rules": [{"pattern": "\\?\\s*$", "tag": "question"}],
  "config": {"engine": "voxcpm", "style": "", "lufs": -16, "denoise": 0.0, "cfg": 2.0},
  "parts": {"A": {"file": "parts/A.flac", "seconds": 120.0, "sha256": "<hex>"}},
  "cadence": {}
}
```

* `format` MUST be `"vcref"`. `version` is an integer; a reader MUST refuse a version greater than it implements.
* `default` MUST be a key of `clips`.
* `clips[tag].file` and `.sha256` are required. `text` (what is said in the clip) is required for cloning.
* `rules` are tried in order against a piece of text; the first whose `pattern` matches selects its `tag`. Patterns are
  regular expressions in the portable subset shared by Python `re` and JavaScript `RegExp` (no lookbehind, no named
  groups, no inline flags). A tag that is not in `clips` falls back to `default`.
* `config` is free-form defaults for the consumer. Unknown keys MUST be preserved by writers that rewrite a bundle and
  ignored by readers.
* `cadence` is optional measured speaking style of the source speaker (see below). Readers that predate it ignore it.
* Unknown top-level keys MUST be ignored and preserved.

### Bundle id

`id` = first 12 hex characters of `sha256( concat( sorted(clip.sha256 for each clip) ) )` where the hex strings are
concatenated as ASCII and hashed as UTF-8. It identifies the audio content and ignores names and settings, so a consumer
can cache decoded clips per id.

### Verification

`verify` recomputes SHA-256 of every `clips/` and `parts/` entry and compares it with the manifest.

### cadence (optional)

Measured speaking style of the source speaker, used to pace synthesis toward the speaker's own rhythm.

```json
"cadence": {
  "v": 1,
  "global":   {"seconds": 268.2, "syll": 1321, "artic": 5.63, "rate": 4.92,
               "pauses": {"comma": {"n": 46, "med": 0.41, "p90": 0.50}, "word": {"n": 30, "med": 0.29, "p90": 0.31}},
               "final": 0.96, "lead": [1.03, 0.98, 1.0], "db": 24.3,
               "sentence_gap": {"n": 45, "med": 0.76, "p25": 0.58, "p90": 1.10},
               "f0": {"med": 117.3, "spread": 10.7, "sd": 4.46}},
  "tags":     {"neutral": {"...": "same shape as global"}},
  "sections": {"opening": {"...": "same shape as global"}}
}
```

`cadence.v` is the cadence schema version (currently 1). Every stats object has the same optional members:

| Member | Meaning |
|---|---|
| `seconds`, `syll` | duration measured and syllables counted |
| `artic` | articulation rate: syllables per second of speech, silences over 0.12 s removed |
| `rate` | syllables per second including pauses |
| `pauses` | `{kind: {n, med, p90}}`, silence in **seconds** after a word ending in a comma-like mark (`comma`: `, ; :`), sentence end (`stop`: `. !`), question (`ask`: `?`) or no punctuation (`word`) |
| `final` | phrase-final lengthening: last-word seconds per syllable relative to the mean (1.0 = none) |
| `lead` | rate contour inside phrases, first/middle/last third relative to the phrase mean |
| `db` | speech level above the noise floor, dB |
| `sentence_gap` | `{n, med, p25, p90}` silence between sentences, seconds |
| `f0` | pitch: `med` Hz, `spread` and `sd` in semitones |

`global` pools all clips; `tags` has one entry per clip tag; `sections` is per recording section. Readers MUST treat
every member as optional and ignore members they do not know.

## Compatibility

Version 1 changes only by adding optional keys. Anything that breaks readers bumps `version` and the comment magic
(`VCREF2`). Reference implementations: Python (`pip install vcref`) and JavaScript (`npm install vcref`); the shared
test fixture `fixtures/tiny.vcref` is read by both test suites.
