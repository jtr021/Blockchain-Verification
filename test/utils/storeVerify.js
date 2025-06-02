#!/usr/bin/env node
import "dotenv/config";
import axios from "axios";
import FormData from "form-data";
import { readFileSync } from "fs";
import { basename } from "path";
import { JsonRpcProvider } from "ethers";

const [, , backend, filePath, fixedId] = process.argv;
if (!backend || !filePath) {
  console.error("Usage: node storeVerify.js <backend> <file> [fixedId]");
  process.exit(1);
}

const cacheState = process.env.CACHE_STATE ?? "";  
const fileName   = basename(filePath);
const provider   = new JsonRpcProvider(
  process.env.RPC_URL ?? "http://127.0.0.1:8545"
);

const tag    = Date.now().toString(36) + "-" + Math.random().toString(16).slice(2, 6);
const fileId = fixedId ?? `${fileName}-${tag}`;

async function main() {

  const fd = new FormData();
  fd.append("file", readFileSync(filePath), fileName);
  fd.append("fileId", fileId);
  fd.append("storageType", backend);

  const t0        = Date.now();
  const storeRes  = await axios.post("http://localhost:3000/store", fd, {
    headers: fd.getHeaders(),
  });
  const storePost = Date.now() - t0;

  const { txHash, ipfsAddMs = null, mysqlInsertMs = null } = storeRes.data ?? {};
  if (!txHash) throw new Error("/store response lacked txHash");

  const tWait     = Date.now();
  const receipt   = await provider.waitForTransaction(txHash, 1);
  const txMinedMs = Date.now() - tWait;
  const storeLatency = Date.now() - t0;


  const fdV = new FormData();
  fdV.append("file", readFileSync(filePath), fileName);
  fdV.append("fileId", fileId);

  const v0 = Date.now();
  const verifyRes = await axios.post("http://localhost:3000/verify", fdV, {
    headers: fdV.getHeaders(),
    validateStatus: () => true,
  });
  const verifyLatency = Date.now() - v0;

  console.log(
    JSON.stringify({
      cacheState,           
      backend,
      file: fileName,
      fileId,
      gasUsed: receipt.gasUsed.toString(),
      storeLatency,
      storePostMs: storePost,
      txMinedMs,
      ipfsAddMs,
      mysqlInsertMs,
      verifyLatency,
      verifyResult: verifyRes.data?.valid ?? false,
      status: verifyRes.status,
    })
  );
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      backend,
      file: fileName,
      fileId,
      status: "exception",
      error: err.message,
    })
  );
  process.exit(1);
});
