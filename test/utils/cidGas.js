#!/usr/bin/env node
import crypto from "crypto";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const [,, template] = process.argv;
if (!template) {
  console.error("Usage: node cid_length_gas.js <templateFilePath>");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const helper    = join(__dirname, "storeVerify.js");

for (let i = 0; i < 15; i++) {
  const tmpName = `tmp_${crypto.randomBytes(4).toString("hex")}.bin`;
  writeFileSync(tmpName, readFileSync(template));
  const buf = readFileSync(tmpName);
  buf[0] = buf[0] ^ (i + 1);
  writeFileSync(tmpName, buf);

  const out = spawnSync("node",
            [helper, "ipfs", tmpName], { encoding: "utf8" });
  process.stdout.write(out.stdout);
  unlinkSync(tmpName);
}
