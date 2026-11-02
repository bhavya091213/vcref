# vcref

A `.vcref` file is a portable **voice reference bundle** for zero-shot voice cloning: every reference clip of one
voice (one per intonation, for example), each with its transcript, plus default settings, regex rules that pick a clip
for a piece of text, and optional speaking-cadence measurements. One file, lossless FLAC inside, SHA-256 per clip.

This repo holds the format spec and two small libraries that read and write it:

| | Install | Docs |
|---|---|---|
| Python (no dependencies; `audio` extra decodes to arrays) | `pip install vcref` / `pip install "vcref[audio]"` | [python/README.md](python/README.md) |
| JavaScript (no dependencies; Node 18+ and browsers) | `npm install vcref` | [js/README.md](js/README.md) |
| The format | | [SPEC.md](SPEC.md) |

Both libraries pass the same tests against `fixtures/tiny.vcref`, produce the same bundle `id`, and read each other's files (checked in CI).

```python
import vcref
with vcref.Bundle("dean.vcref") as b:
    clip = b.clip(b.select_tag("Is this working?"))   # rules pick the clip, else the default
    print(clip.text, clip.sample_rate, len(clip.flac))  # FLAC bytes ready for your TTS prompt
```

```js
import { Bundle } from "vcref";
const b = await Bundle.open("dean.vcref");
const clip = await b.clip(b.selectTag("Is this working?"));
```

CLI in both: `vcref info|verify <file>` and `vcref unpack <file> <dir>`.

## Repo layout

```
SPEC.md          the format
python/          pip package (hatchling, src layout)
js/              npm package (ESM, no build step, .d.ts included)
fixtures/        tiny.vcref + tiny.id shared by both test suites; make_fixture.py regenerates them
.github/         CI (both test suites + cross-read) and tag-triggered releases to PyPI and npm
```

## Releasing

Tag `vX.Y.Z` after bumping `python/pyproject.toml`, `python/src/vcref/__init__.py` and `js/package.json`. The release
workflow publishes to PyPI (trusted publishing, no token stored) and npm (`NPM_TOKEN` secret, with provenance).
One-time setup: create the PyPI project with a trusted publisher pointing at this repo's `release.yml`, and add the npm token.

MIT licensed.
