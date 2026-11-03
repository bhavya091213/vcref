# vcref (JavaScript)

Read, write and verify `.vcref` voice reference bundles. No dependencies; Node 18+ and browsers.
Format: [SPEC.md](https://github.com/bhavya091213/vcref/blob/main/SPEC.md).

```
npm install vcref
```

```js
import { Bundle, pack } from "vcref";

const b = await Bundle.open("dean.vcref");        // Node; in a browser: Bundle.fromBytes(await (await fetch(url)).arrayBuffer())
b.name; b.default; b.tags; b.config; b.cadence;
await b.id();
await b.verify();                                  // SHA-256 of every clip and part
const clip = await b.clip(b.selectTag("Really?")); // { tag, text, seconds, label, sampleRate, flac: Uint8Array }

// FLAC bytes only: audio is not encoded or decoded here (browser: new AudioContext().decodeAudioData(clip.flac.buffer))
const bytes = await pack({ clips: { neutral: { flac, text: "What is said." } }, name: "voice", rules: [] });
```

Errors are `VcrefError`. Command line: `npx vcref info|verify <file>`, `npx vcref unpack <file> <dir>`.

## Choosing and inspecting references

```js
b.explain("Really?");                 // { tag, why: "rule" | "default", rule, pattern }
await b.prompt("Really?", true);      // [selected clip, default clip] ready for a TTS prompt
b.search("podcast");                  // tags whose tag, label or transcript contain the text
b.stats();                            // clipBytes, partBytes, kbps, pcm16Ratio, perClip (no decoding)
```

Guides: [compression](../docs/compression.md), [extracting references](../docs/extracting-references.md), [best practices](../docs/best-practices.md).
