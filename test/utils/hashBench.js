#!/usr/bin/env node

import crypto from 'crypto';
import { readFileSync } from 'fs';
import { basename } from 'path';

const [, , filePath, reps = 20] = process.argv;
if (!filePath) {
  console.error('Usage: hashBench.js <file> [repeats]');
  process.exit(1);
}
const buf = readFileSync(filePath);
for (let i = 0; i < Number(reps); i++) {
  const t0 = Date.now();
  crypto.createHash('sha256').update(buf).digest();
  console.log(JSON.stringify({ file: basename(filePath), hashTimeMs: Date.now() - t0 }));
}
