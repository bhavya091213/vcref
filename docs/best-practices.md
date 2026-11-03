# Getting the most out of .vcref

The format is only a container. The quality of the clone comes from the audio and the transcripts you put in it.

## Record

* **Bad input gives bad output.** A reference with room echo, hiss, clipping or a noisy fan teaches the model that
  sound, and it will reproduce it. Record close to the microphone in a quiet, soft room.
* **Capture range, not volume.** You do not need hours. A few minutes in total is enough if it covers the ways you
  speak: calm, questioning, excited, quiet, serious, warm. One clip per style beats ten near-duplicates.
* **Read it like you mean it.** Models copy delivery. A flat read of an exciting sentence produces a flat clone of an
  exciting sentence.
* **Keep clips clean.** Each clip should be one continuous piece of speech without coughs, long pauses or someone else
  talking. Clips of roughly five to fifteen seconds are a sensible target (a rule of thumb; check by ear for your engine).

## Label

* **Use the real transcript**, with the punctuation you spoke. The model aligns text to audio, so a paraphrase or a
  missing word causes drift.
* **Name tags for what the clip sounds like**, not where it came from: `question`, `excited`, `whisper`, `story_scene`.
  Tags are part of your rules and your code.
* **Always have a neutral default.** It is the fallback for any text no rule matches, and the anchor for stacking.

## Write rules

* Keep them few and obvious (a trailing `?`, a trailing `!`, a leading marker). Rules are tried in order, so put the
  most specific first.
* Stay in the portable regex subset: no lookbehind, no named groups, no inline flags. The same bundle must behave the
  same in Python and JavaScript, and `pack` refuses patterns that do not compile.
* Test them with `explain` on real lines before a long render.

## Use

* Pick the clip per line, not per project. A script with questions, asides and emphatic lines sounds more alive when
  each line is prompted with a fitting clip.
* Write the script the way people talk. A text that reads like machine output (stiff, uniform sentences, no
  contractions) makes any voice sound robotic, however good the reference.
* Stack the neutral clip when emotional clips make the timbre wander.
* Cache generated lines by `(bundle.id, tag, text)`. Re-rendering an unchanged line is wasted time.

## Keep

* Call `verify()` after copying or downloading a bundle.
* A bundle holds a recording of a person's voice. Treat it as personal data: do not publish one without the speaker's
  consent, and keep `.vcref` files out of public repositories.
* Use `set_cadence` to add or refresh the pacing block without touching any audio.

## Limits worth knowing

* The format stores references. It does not improve them. If a recording is poor, fix the recording; techniques such
  as audio super-resolution or denoising before enrollment may help, but verify the result by ear.
* Compression is lossless, so file size follows the audio you keep. Fewer, better clips is the way to a smaller file.
