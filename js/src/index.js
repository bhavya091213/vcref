// vcref: read, write and verify .vcref voice reference bundles (format spec: SPEC.md). No dependencies.
// Works in Node >= 18 and modern browsers (Web Crypto + DecompressionStream). Audio is returned as FLAC bytes;
// decode it with your audio stack (e.g. AudioContext.decodeAudioData in a browser).

export const MAGIC = "VCREF1";
export const VERSION = 1;

export class VcrefError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "VcrefError";
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8");
const TAG = /^[A-Za-z0-9_-]+$/;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function sha256Hex(bytes) {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Parse a ZIP into {comment, entries: Map(name -> {method, csize, usize, crc, offset})}. */
function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new VcrefError("not a readable vcref (no zip directory)");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const clen = dv.getUint16(eocd + 20, true);
  const comment = dec.decode(u8.subarray(eocd + 22, eocd + 22 + clen));
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new VcrefError("corrupt zip directory");
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const klen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    entries.set(name, { method, crc, csize, usize, offset });
    p += 46 + nlen + xlen + klen;
  }
  return { comment, entries };
}

async function entryBytes(u8, e, name) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(e.offset, true) !== 0x04034b50) throw new VcrefError(`corrupt entry ${name}`);
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  const raw = u8.subarray(start, start + e.csize);
  let out;
  if (e.method === 0) out = raw;
  else if (e.method === 8) out = await inflateRaw(raw);
  else throw new VcrefError(`entry ${name}: unsupported zip method ${e.method}`);
  if (crc32(out) !== e.crc) throw new VcrefError(`corrupt entry ${name} (bad CRC-32)`);
  return out;
}

export class Bundle {
  /** @param {Uint8Array} u8 whole file */
  constructor(u8, zip, manifest) {
    this._u8 = u8;
    this._zip = zip;
    this.manifest = manifest;
  }

  /** Parse a bundle from its bytes (Uint8Array, ArrayBuffer or Node Buffer). */
  static async fromBytes(bytes) {
    // plain Uint8Array view (a Node Buffer would leak Buffer-typed slices to callers)
    const u8 = ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
    const zip = readZip(u8);
    if (zip.comment !== MAGIC) throw new VcrefError("not a vcref file (bad magic)");
    const me = zip.entries.get("manifest.json");
    if (!me) throw new VcrefError("bad manifest.json (missing)");
    let m;
    try {
      m = JSON.parse(dec.decode(await entryBytes(u8, me, "manifest.json")));
    } catch (e) {
      if (e instanceof VcrefError) throw e;
      throw new VcrefError(`bad manifest.json (${e.message})`);
    }
    if (m.format !== "vcref" || (m.version ?? 0) > VERSION) throw new VcrefError(`unsupported vcref version ${m.version}`);
    if (!m.clips || !(m.default in m.clips)) throw new VcrefError("manifest default is not a clip");
    return new Bundle(u8, zip, m);
  }

  /** Node only: read a bundle from disk. */
  static async open(path) {
    const { readFile } = await import("node:fs/promises");
    return Bundle.fromBytes(await readFile(path));
  }

  get name() { return this.manifest.name; }
  get default() { return this.manifest.default; }
  get config() { return this.manifest.config ?? {}; }
  get tags() { return Object.keys(this.manifest.clips); }
  get parts() { return Object.keys(this.manifest.parts ?? {}); }
  get cadence() { return this.manifest.cadence ?? null; }

  /** 12-hex content id: hash of the sorted clip hashes (ignores names and settings). */
  async id() {
    const hashes = Object.values(this.manifest.clips).map((c) => c.sha256).sort();
    return (await sha256Hex(enc.encode(hashes.join("")))).slice(0, 12);
  }

  /** [{pattern: RegExp, tag}] in order. */
  rules() {
    return (this.manifest.rules ?? []).map((r) => ({ pattern: new RegExp(r.pattern), tag: r.tag }));
  }

  /** The clip tag the rules choose for `text` (first match), else the default. */
  selectTag(text) {
    for (const { pattern, tag } of this.rules()) if (pattern.test(text) && tag in this.manifest.clips) return tag;
    return this.default;
  }

  /** Why selectTag(text) returns what it does: {tag, why: "rule"|"default", rule, pattern}. */
  explain(text) {
    const rules = this.rules();
    for (let i = 0; i < rules.length; i++) {
      if (rules[i].pattern.test(text) && rules[i].tag in this.manifest.clips) {
        return { tag: rules[i].tag, why: "rule", rule: i, pattern: rules[i].pattern.source };
      }
    }
    return { tag: this.default, why: "default", rule: null, pattern: null };
  }

  /** Reference clips for `text`: the rule-selected clip first, then (stack) the default as a neutral anchor. */
  async prompt(text, stack = false) {
    const tag = this.selectTag(text);
    const clips = [await this.clip(tag)];
    if (stack && tag !== this.default) clips.push(await this.clip(this.default));
    return clips;
  }

  /** Tags whose tag, label or transcript contains `query` (case-insensitive). */
  search(query) {
    const q = query.toLowerCase();
    return Object.entries(this.manifest.clips)
      .filter(([t, c]) => t.toLowerCase().includes(q) || (c.label ?? "").toLowerCase().includes(q) || c.text.toLowerCase().includes(q))
      .map(([t]) => t);
  }

  /** Sizes and bitrates from the zip directory (no decoding). pcm16Ratio = raw 16-bit PCM size / stored clip size. */
  stats() {
    const perClip = [];
    let raw = 0;
    for (const [tag, c] of Object.entries(this.manifest.clips)) {
      const bytes = this._zip.entries.get(c.file).usize;
      const seconds = c.seconds ?? null, sampleRate = c.sample_rate ?? null;
      if (seconds && sampleRate) raw += Math.floor(seconds * sampleRate * 2);
      perClip.push({ tag, seconds, sampleRate, bytes, kbps: seconds ? Math.round((bytes * 8) / seconds / 1000) : null });
    }
    const clipBytes = perClip.reduce((n, p) => n + p.bytes, 0);
    const partBytes = Object.values(this.manifest.parts ?? {}).reduce((n, p) => n + this._zip.entries.get(p.file).usize, 0);
    const secs = perClip.reduce((n, p) => n + (p.seconds ?? 0), 0);
    return {
      clips: perClip.length, clipSeconds: Math.round(secs * 10) / 10, clipBytes, partBytes, fileBytes: clipBytes + partBytes,
      kbps: secs ? Math.round((clipBytes * 8) / secs / 1000) : null,
      pcm16Ratio: raw && clipBytes ? Math.round((raw / clipBytes) * 100) / 100 : null, perClip,
    };
  }

  async _read(file) {
    const e = this._zip.entries.get(file);
    if (!e) throw new VcrefError(`missing entry ${file}`);
    return entryBytes(this._u8, e, file);
  }

  /** Clip for `tag` (unknown/undefined -> default) with FLAC bytes. */
  async clip(tag) {
    if (!(tag in this.manifest.clips)) tag = this.default;
    const c = this.manifest.clips[tag];
    return { tag, text: c.text, seconds: c.seconds ?? null, label: c.label ?? null, sampleRate: c.sample_rate ?? null, flac: await this._read(c.file) };
  }

  /** FLAC bytes of an enrollment recording. */
  async part(name) {
    return this._read(this.manifest.parts[name].file);
  }

  /** Throws VcrefError on any hash mismatch or missing entry; resolves true otherwise. */
  async verify() {
    for (const kind of ["clips", "parts"]) {
      for (const [key, meta] of Object.entries(this.manifest[kind] ?? {})) {
        if ((await sha256Hex(await this._read(meta.file))) !== meta.sha256) {
          throw new VcrefError(`${kind.slice(0, -1)} '${key}' is corrupt (hash mismatch)`);
        }
      }
    }
    return true;
  }
}

function flacRate(data) {
  if (data.length < 22 || dec.decode(data.subarray(0, 4)) !== "fLaC") throw new VcrefError("flac bytes do not start with 'fLaC'");
  return ((data[18] << 12) | (data[19] << 4) | (data[20] >> 4)) >>> 0; // STREAMINFO sample rate (20 bits)
}

function u16(n) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; }
function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; }
function cat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function zipStored(files, comment) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nb = enc.encode(name), crc = crc32(data);
    const local = cat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(nb.length), u16(0), nb, data]);
    central.push(cat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(nb.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nb]));
    locals.push(local);
    offset += local.length;
  }
  const dir = cat(central), cb = enc.encode(comment);
  return cat([...locals, dir, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(dir.length), u32(offset), u16(cb.length), cb]);
}

/**
 * Build a bundle and return its bytes (Uint8Array).
 * clips: {tag: {text, flac: Uint8Array, label?, source?, seconds?}}  parts: {name: {flac, seconds?}}
 * Audio must already be FLAC; this library does not encode audio.
 */
export async function pack({ clips, name = "voice", defaultTag, rules = [], config = {}, cadence = null, parts = {} }) {
  const tags = Object.keys(clips ?? {});
  if (!tags.length) throw new VcrefError("a bundle needs at least one clip");
  const files = [], mclips = {}, mparts = {};
  for (const tag of tags) {
    if (!TAG.test(tag)) throw new VcrefError(`bad tag '${tag}': use letters, digits, '_' or '-'`);
    const spec = clips[tag];
    if (!spec.text) throw new VcrefError(`clip '${tag}' has no transcript text`);
    const flac = new Uint8Array(spec.flac);
    files.push([`clips/${tag}.flac`, flac]);
    const entry = { file: `clips/${tag}.flac`, text: spec.text, seconds: spec.seconds, label: spec.label, source: spec.source, sample_rate: flacRate(flac), sha256: await sha256Hex(flac) };
    mclips[tag] = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined));
  }
  for (const [pn, spec] of Object.entries(parts)) {
    if (!TAG.test(pn)) throw new VcrefError(`bad part name '${pn}'`);
    const flac = new Uint8Array(spec.flac);
    files.push([`parts/${pn}.flac`, flac]);
    mparts[pn] = Object.fromEntries(Object.entries({ file: `parts/${pn}.flac`, seconds: spec.seconds, sha256: await sha256Hex(flac) }).filter(([, v]) => v !== undefined));
  }
  const def = defaultTag ?? (tags.includes("neutral") ? "neutral" : tags[0]);
  if (!(def in mclips)) throw new VcrefError(`default '${def}' is not a clip`);
  for (const r of rules) {
    new RegExp(r.pattern); // fail now, not at read time
    if (!(r.tag in mclips)) throw new VcrefError(`rule tag '${r.tag}' is not a clip`);
  }
  const manifest = { format: "vcref", version: VERSION, name, created: new Date().toISOString().slice(0, 10), default: def, clips: mclips, rules, config, parts: mparts };
  if (cadence) manifest.cadence = cadence;
  files.push(["manifest.json", enc.encode(JSON.stringify(manifest, null, 1))]);
  return zipStored(files, MAGIC);
}
