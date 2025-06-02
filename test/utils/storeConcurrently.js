#!/usr/bin/env node

import { spawn } from "child_process";

const [,, threads, backend, filePath] = process.argv;
if (!threads || !backend || !filePath) {
  console.error("Usage: node storeConcurrently.js <threads> <backend> <file>");
  process.exit(1);
}

async function run() {
  const promises = [];
  for (let i = 0; i < Number(threads); i++) {
    promises.push(new Promise(res => {
      const p = spawn("node",
        ["test/utils/storeVerify.js", backend, filePath],
        { stdio: ["ignore", "pipe", "inherit"] }
      );
      p.stdout.on("data", d => process.stdout.write(d));
      p.on("close", (code) => res(code));
    }));
  }
  await Promise.all(promises);
  const codes = await Promise.all(promises);
  if (codes.some(c => c !== 0)) process.exit(1);
}
run();
