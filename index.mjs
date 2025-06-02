"use strict";

import fs from "fs";
import crypto from "crypto";
import mysql from "mysql2/promise";
import { create } from "ipfs-http-client";
import { ethers, keccak256, toUtf8Bytes } from "ethers";
import "dotenv/config";

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const PRIVATE_KEY = process.env.PRIVATE_KEY || null;
let addresses;
let CONTRACT_ADDRESS;
try {
  addresses = JSON.parse(fs.readFileSync("deployedAddresses.json", "utf8"));
  CONTRACT_ADDRESS = addresses.DataInt;
} catch (e) {
  throw new Error("Failed to load deployedAddresses.json.");
}

const CONTRACT_ABI_PATH = "artifacts/contracts/DataInt.sol/DataInt.json";
const STORAGE_TYPE = process.env.STORAGE_TYPE ? process.env.STORAGE_TYPE.toLowerCase() : "centralized";

const DB_HOST = process.env.DB_HOST || "mysql";
const DB_USER = process.env.DB_USER || "root";
const DB_PASS = process.env.DB_PASS || "";
const DB_NAME = process.env.DB_NAME || "data_integrity";
const DB_PORT = process.env.DB_PORT || 3306;
const IPFS_URL = process.env.IPFS_URL || "http://localhost:5001";
const IPFS_PIN = !!process.env.IPFS_PIN;

function calculateChecksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function createIpfsClient(options) {
  return create(options);
}

const contractJson = JSON.parse(fs.readFileSync(CONTRACT_ABI_PATH, "utf8"));
const provider = new ethers.JsonRpcProvider(RPC_URL);
let contractWrite = null;
if (PRIVATE_KEY) {
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  contractWrite = new ethers.Contract(CONTRACT_ADDRESS, contractJson.abi, signer);
}

const toBytes32 = (s) => keccak256(toUtf8Bytes(s));

async function fileIdExistsOnChain(fileId) {
  if (!contractWrite) return false;
  try {
    await contractWrite.getData(toBytes32(fileId));
    return true;
  } catch (e) {
    if (e.errorName === "DataNotFound" || (e.reason && e.reason.includes("DataNotFound"))) {
      return false;
    }
    console.error("[fileIdExistsOnChain] Unexpected error:", e);
    throw e;
  }
}

async function getTimestamp(fileId) {
  const contract =
    contractWrite ??
    new ethers.Contract(CONTRACT_ADDRESS, contractJson.abi, provider);
  const data = await contract.getData(toBytes32(fileId));
  return data[3];
} 


async function storeData(fileId, filePath, storageTypeParam = null) {
  const storageType = storageTypeParam ? storageTypeParam.toLowerCase() : STORAGE_TYPE;
  if (storageType !== "centralized" && storageType !== "ipfs") {
    throw new Error("Invalid storage type: " + storageType);
  }
  if (await fileIdExistsOnChain(fileId)) {
    throw new Error(`File ID "${fileId}" already exists on-chain. Please use a unique File ID.`);
  }

  let fileBytes;
  try {
    fileBytes = fs.readFileSync(filePath);
  } catch (err) {
    throw new Error("Error reading file: " + err.message);
  }

  const checksum = calculateChecksum(fileBytes);
  let pointer = "";

  if (storageType === "centralized") {
    try {
      console.log("Connecting to MySQL at:", DB_HOST, DB_PORT, DB_USER, DB_NAME);
      const dbConn = await mysql.createConnection({
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
        port: DB_PORT
      });
      const [rows] = await dbConn.execute("SELECT id FROM files WHERE id = ?", [fileId]);
      await dbConn.end();
      if (rows.length > 0) {
        throw new Error(`File ID "${fileId}" already exists in MySQL; choose a new ID.`);
      };
    } catch (dbError) {
      console.error("Full database error:", dbError);
      throw new Error("Database error: " + dbError.message);
    }
  } else if (storageType === "ipfs") {
    try {
      const ipfsClient = createIpfsClient({ url: IPFS_URL });
      const result = await ipfsClient.add(fileBytes);
      pointer = result.path ? result.path : result.cid.toString();
      console.log("CID =", pointer);
      if (IPFS_PIN) {
        try {
          await ipfsClient.pin.add(pointer);
        } catch (pinError) {
          console.warn("[Warn] Failed to pin IPFS CID", pinError);
        }
      }
    } catch (ipfsError) {
      throw new Error(`IPFS upload error: ${ipfsError}`);
    }
  }

  if (!contractWrite) {
    console.warn("[WARN] No signer found. Skipping on-chain store.");
    return { receipt: null, cid: storageType === "ipfs" ? pointer : null };
  }

  const storageTypeFlag = storageType === "centralized" ? 0 : 1;
  const idBytes32 = toBytes32(fileId);

  const pointerHash = storageType === "ipfs" ? keccak256(toUtf8Bytes(pointer)) : ethers.ZeroHash;

  try {
    const rawEstimate = await contractWrite.storeData.estimateGas(
      idBytes32,
      storageTypeFlag,
      pointerHash,
      checksum.startsWith('0x') ? checksum : `0x${checksum}`
    );
    const gasLimit = rawEstimate * 12n / 10n;
    const tx = await contractWrite.storeData(
      idBytes32,
      storageTypeFlag,
      pointerHash,
      checksum.startsWith('0x') ? checksum : `0x${checksum}`,
      { gasLimit }
    );
    console.info("[INFO] Transaction submitted, awaiting confirmation...");
    const receipt = await tx.wait();
    console.info(`[INFO] Transaction mined. Tx hash: ${receipt.transactionHash || receipt.hash}`);

    if (storageType === "centralized") {
      const dbConn2 = await mysql.createConnection({
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
        port: DB_PORT
      });
      await dbConn2.execute(
        "INSERT INTO files (id, file_blob, checksum) VALUES (?, ?, ?)",
        [fileId, fileBytes, checksum]
      );
      await dbConn2.end();
    }

    return { receipt, cid: storageType === "ipfs" ? pointer : null };
  } catch (chainError) {
    throw new Error("Blockchain transaction error: " + chainError.message);
  }
}

async function verifyData(fileId, localFilePath = null) {
  const contract =
    contractWrite ??
    new ethers.Contract(CONTRACT_ADDRESS, contractJson.abi, provider);

  let data;
  try {
    const idBytes32 = toBytes32(fileId); 
    data = await contract.getData(idBytes32);
    
    console.log("Raw data from contract:", data);
  } catch (e) {
    if (e.reason && e.reason.includes("Data not found")) {
      throw new Error(`No data found for File ID "${fileId}" on the blockchain.`);
    }
    throw new Error("Failed to fetch data from contract: " + e.message);
  }

  let [storageTypeFlag, pointer, onChainChecksum] = data;
  storageTypeFlag = Number(storageTypeFlag);

  let fileBytes;
  if (localFilePath) {
    fileBytes = fs.readFileSync(localFilePath);
  } else if (storageTypeFlag === 0) {
    if (!localFilePath) {
      throw new Error("Verification requires you to upload the file.");
    }
    try {
      const dbConn = await mysql.createConnection({
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASS,
        database: DB_NAME
      });
      const [rows] = await dbConn.execute("SELECT file_blob FROM files WHERE id = ?", [fileId]);
      await dbConn.end();
      if (rows.length === 0) {
        throw new Error("No file found in database for this ID.");
      }
      fileBytes = rows[0].file_blob;
    } catch (dbError) {
      console.error("Full database error:", dbError);
      throw new Error("Database error: " + dbError.message);
    }
  } else if (storageTypeFlag === 1) {
    const ipfsClient = createIpfsClient({ url: IPFS_URL });
    const chunks = [];
    for await (const chunk of ipfsClient.cat(pointer)) {
      chunks.push(chunk);
    }
    fileBytes = Buffer.concat(chunks);
  } else {
    throw new Error("Unknown storage type flag.");
  }

  const calculatedChecksum = calculateChecksum(fileBytes);
  const cleanCalculated = calculatedChecksum.replace(/^0x/, '').toLowerCase();
  const cleanOnChain = onChainChecksum.replace(/^0x/, '').toLowerCase();

  if (cleanCalculated === cleanOnChain) {
    console.info(`[VERIFY] Success! Checksum matches on-chain record.`);
    return true;
  } else {
    console.error(`[VERIFY] FAILURE: Checksum does not match. On-chain: ${onChainChecksum}, Calculated: ${calculatedChecksum}`);
    return false;
  }
}

export { storeData, verifyData, getTimestamp };
