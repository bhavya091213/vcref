#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Bundle, VcrefError } from "../src/index.js";

const [cmd, file, dir] = process.argv.slice(2);
if (!["info", "verify", "unpack"].includes(cmd) || !file || (cmd === "unpack" && !dir)) {
  console.error("usage: vcref info|verify <file.vcref>   |   vcref unpack <file.vcref> <dir>");
  process.exit(2);
}
try {
  const b = await Bundle.open(file);
  if (cmd === "info") {
    console.log(`${b.name}  id=${await b.id()}  default=${b.default}  rules=${(b.manifest.rules ?? []).length}  parts=${b.parts.length}  cadence=${b.cadence ? "yes" : "no"}`);
    for (const [t, c] of Object.entries(b.manifest.clips)) console.log(`  ${t.padEnd(12)} ${String((c.seconds ?? 0).toFixed(1)).padStart(6)}s ${String(c.sample_rate ?? 0).padStart(6)} Hz  ${c.text.slice(0, 60)}`);
  } else if (cmd === "verify") {
    await b.verify();
    console.log("ok");
  } else {
    await mkdir(dir, { recursive: true });
    for (const t of b.tags) {
      const c = await b.clip(t);
      await writeFile(join(dir, `${t}.flac`), c.flac);
      await writeFile(join(dir, `${t}.txt`), c.text, "utf8");
    }
    console.log(dir);
  }
} catch (e) {
  if (e instanceof VcrefError || e.code === "ENOENT") {
    console.error(`vcref: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
