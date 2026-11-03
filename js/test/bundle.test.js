import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Bundle, VcrefError, pack, crc32 } from "../src/index.js";

const FIX = new URL("../../fixtures/tiny.vcref", import.meta.url);

test("reads the shared fixture", async () => {
  const b = await Bundle.open(FIX);
  assert.equal(b.name, "tiny");
  assert.equal(b.default, "neutral");
  assert.deepEqual(b.tags, ["neutral", "question"]);
  assert.deepEqual(b.parts, ["A"]);
  assert.equal(b.config.lufs, -16);
  assert.equal(b.cadence.global.artic, 5.6);
  assert.equal(await b.verify(), true);
  assert.equal((await b.id()).length, 12);
});

test("explain, prompt, search and stats", async () => {
  const b = await Bundle.open(FIX);
  const e = b.explain("Really?");
  assert.deepEqual([e.tag, e.why, e.rule], ["question", "rule", 0]);
  assert.equal(b.explain("Plain.").why, "default");
  assert.deepEqual((await b.prompt("Really?")).map((c) => c.tag), ["question"]);
  assert.deepEqual((await b.prompt("Really?", true)).map((c) => c.tag), ["question", "neutral"]);
  assert.deepEqual((await b.prompt("Plain.", true)).map((c) => c.tag), ["neutral"]);
  assert.ok(b.search("QUEST").includes("question"));
  const s = b.stats();
  assert.equal(s.clips, 2);
  assert.equal(s.fileBytes, s.clipBytes + s.partBytes);
  assert.ok(s.clipBytes > 0);
});

test("id matches the Python implementation", async () => {
  const b = await Bundle.open(FIX);
  const expected = (await readFile(new URL("../../fixtures/tiny.id", import.meta.url), "utf8")).trim();
  assert.equal(await b.id(), expected);
});

test("rules and default fallback", async () => {
  const b = await Bundle.open(FIX);
  assert.equal(b.selectTag("Really?"), "question");
  assert.equal(b.selectTag("Plain."), "neutral");
  assert.equal((await b.clip("nope")).tag, "neutral");
});

test("clip bytes are FLAC with the right rate", async () => {
  const b = await Bundle.open(FIX);
  const c = await b.clip("question");
  assert.equal(String.fromCharCode(...c.flac.slice(0, 4)), "fLaC");
  assert.equal(c.sampleRate, 16000);
});

test("pack then read round trip", async () => {
  const src = await Bundle.open(FIX);
  const flac = (await src.clip("neutral")).flac;
  const bytes = await pack({ clips: { neutral: { flac, text: "hello" } }, name: "rt", cadence: { v: 1, global: { artic: 4 } } });
  const b = await Bundle.fromBytes(bytes);
  assert.equal(await b.verify(), true);
  assert.deepEqual((await b.clip()).flac, flac);
  assert.equal(b.cadence.global.artic, 4);
  if (process.env.VCREF_JS_OUT) await writeFile(process.env.VCREF_JS_OUT, bytes); // CI: Python re-reads this file
});

test("corruption is detected", async () => {
  const data = new Uint8Array(await readFile(FIX));
  const i = Buffer.from(data).indexOf("fLaC") + 60;
  data[i] ^= 0xff;
  await assert.rejects(async () => (await Bundle.fromBytes(data)).verify(), VcrefError);
});

test("rejects non-vcref input", async () => {
  await assert.rejects(Bundle.fromBytes(new Uint8Array([1, 2, 3])), VcrefError);
});

test("validates pack input", async () => {
  await assert.rejects(pack({ clips: {} }), VcrefError);
  await assert.rejects(pack({ clips: { "bad tag": { flac: new Uint8Array(30), text: "t" } } }), VcrefError);
});

test("crc32 known value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});
