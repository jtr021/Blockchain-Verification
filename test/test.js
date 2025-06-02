
import { readFileSync, mkdirSync, existsSync, appendFileSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const [, , testId] = process.argv;
if (!testId) {
  console.error("Usage: node test.js <testId 01-10 | all>");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(__dirname, "tests.json"), "utf8"));

if (testId === "all") {
  for (const k of Object.keys(spec).sort()) {
    console.log(`\n=== Running test ${k} ===`);
    const r = spawnSync("node", [process.argv[1], k], { stdio: "inherit" });
    if (r.status) process.exit(r.status);
  }
  process.exit(0);
}

const cfg = spec[testId];
if (!cfg) {
  console.error(`Test ${testId} not found in tests.json`);
  process.exit(1);
}

if (cfg.env) Object.assign(process.env, cfg.env);

function spawnHelper(helperPath, args = [], extra = {}) {
  const p = spawnSync(
    "node",
    [helperPath, ...args],
    {
      encoding: "utf8",
      env: { ...process.env, ...(extra.env || {}) },
    }
  );
  if (p.status !== 0) {
    console.error(p.stderr || p.stdout);
    process.exit(1);
  }
  return p.stdout.trim().split(/\r?\n/);
}

const utilsDir = join(__dirname, "utils");
const outDir   = join(__dirname, "results");
if (!existsSync(outDir)) mkdirSync(outDir);

let lines = [];

switch (cfg.runner) {
  case "store": {
    const helper = join(utilsDir, "storeVerify.js");
    for (const file of cfg.files) {
      const abs = resolve(__dirname, "..", file);
      for (let i = 0; i < cfg.repeats; i++) {
        lines.push(
          ...spawnHelper(helper, [process.env.STORAGE_TYPE, abs])
        );
        console.log(`✅  ${file} run ${i + 1}/${cfg.repeats}`);
      }
    }
    break;
  }

  case "concurrent": {
    const helper = join(utilsDir, "storeConcurrently.js");
    const abs    = resolve(__dirname, "..", cfg.file);
    for (const n of cfg.concurrencyLevels) {
      lines.push(
        ...spawnHelper(helper, [n, process.env.STORAGE_TYPE, abs])
      );
    }
    break;
  }

  case "tamper": {
    const helper       = join(utilsDir, "storeVerify.js");
    const verifyHelper = join(utilsDir, "verifyOnly.js");
    const abs          = resolve(__dirname, "..", cfg.file);
    const unique       = `${cfg.file}-${Date.now()}`;

    lines.push(
      ...spawnHelper(helper, [process.env.STORAGE_TYPE, abs, unique])
    );

    console.log("…tampering MySQL row");
    spawnSync(
      "docker",
      [
        "compose", "exec", "-T", "mysql",
        "mysql", "-h", "mysql",
        "-uscript", "-pscriptPw",
        "-e", `UPDATE files SET file_blob='tamper' WHERE id='${unique}'`,
        "data_integrity",
      ],
      { stdio: "inherit" }
    );

    
    lines.push(
      ...spawnHelper(verifyHelper, [process.env.STORAGE_TYPE, abs, unique])
    );
    break;
  }

  case "cid": {
    const helper = join(utilsDir, "cidGas.js");
    const abs    = resolve(__dirname, "..", cfg.file);
    lines.push(...spawnHelper(helper, [abs]));
    break;
  }

  case "coldWarm": {
    const helper = join(utilsDir, "storeVerify.js");
    const abs    = resolve(__dirname, "..", cfg.file);


    for (let i = 0; i < cfg.restarts; i++) {
      console.log("Restarting IPFS container… (cold run)");
      spawnSync("docker", ["compose", "restart", "ipfs"], { stdio: "inherit" });
      await new Promise((r) =>
        setTimeout(r, cfg.waitAfterRestartMs ?? 15_000)
      );
      lines.push(
        ...spawnHelper(
          helper,
          [process.env.STORAGE_TYPE, abs],
          { env: { CACHE_STATE: "cold" } }
        )
      );
    }


    for (let i = 0; i < cfg.restarts; i++) {
      lines.push(
        ...spawnHelper(
          helper,
          [process.env.STORAGE_TYPE, abs],
          { env: { CACHE_STATE: "warm" } }
        )
      );
    }
    break;
  }

  case "hashBench": {
    const helper = join(utilsDir, "hashBench.js");
    const abs    = resolve(__dirname, "..", cfg.file);
    lines.push(
      ...spawnHelper(helper, [abs, cfg.repeats ?? 20])
    );
    break;
  }

  default:
    console.error(`Unknown runner type: ${cfg.runner}`);
    process.exit(1);
}

const stamp   = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = join(outDir, `test_${testId}_${cfg.runner}_${stamp}.csv`);
lines.forEach((l) => appendFileSync(outFile, l + "\n"));
console.log(`\n✅  Finished "${cfg.name}".  Results →  ${outFile}`);
