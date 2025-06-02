#!/usr/bin/env node

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const RAW_DIR = "test/results";
const OUT_CSV = "test/results/summary.csv";

function numeric(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function mean(arr) {
  return arr.reduce((a, v) => a + v, 0) / arr.length;
}
function stdev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}

const rows = [];

for (const file of readdirSync(RAW_DIR).filter((f) => f.endsWith(".csv"))) {
  const id = file.match(/test_(\d\d)/)?.[1] ?? "??";
  const lines = readFileSync(join(RAW_DIR, file), "utf8")
    .trim()
    .split(/\r?\n/);

  for (const json of lines) {
    try {
      const obj = JSON.parse(json);
      rows.push({ id, ...obj });
    } catch {
    }
  }
}

if (!rows.length) {
  console.error("No raw CSV rows found; run test/test.js first.");
  process.exit(1);
}


const groups = {};
for (const r of rows) {
  const key = [r.id, r.backend, r.file, r.cacheState ?? ""].join("|");
  (groups[key] = groups[key] || []).push(r);
}

let csv = "id,backend,file,runs,gasMean,gasSD,latMean,latSD\n";

for (const [key, records] of Object.entries(groups)) {
  const valid = records.filter(
    (o) =>
      Number.isFinite(numeric(o.gasUsed)) &&
      Number.isFinite(numeric(o.storeLatency))
  );
  if (!valid.length) continue;

  const [id, backend, file] = key.split("|");
  const gasArr = valid.map((o) => numeric(o.gasUsed));
  const latArr = valid.map((o) => numeric(o.storeLatency));

  csv += [
    id,
    backend,
    file,
    valid.length,
    mean(gasArr).toFixed(0),
    stdev(gasArr).toFixed(0),
    mean(latArr).toFixed(0),
    stdev(latArr).toFixed(0),
  ].join(",") + "\n";
}

writeFileSync(OUT_CSV, csv);
console.log(`✓  Summary written to ${OUT_CSV}`);
