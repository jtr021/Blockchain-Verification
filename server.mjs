#!/usr/bin/env node
"use strict";

import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import { body, validationResult } from "express-validator";
import { storeData, verifyData, getTimestamp } from "./index.mjs";
import { keccak256, toUtf8Bytes } from "ethers"; 
import fs from "fs";

// Setup
const logFile = 'performance.log';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const upload = multer({ dest: "uploads/" });

// Apply rate limiting: max 30 requests per minute
const limiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: "Too many requests—please slow down."
});
app.use(limiter);
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

function logPerformance(endpoint, start, end, status) {
  const duration = end - start;
  const msg = `${new Date().toISOString()} | ${endpoint} | ${duration}ms | ${status}\n`;
  fs.appendFileSync(logFile, msg);
}

// Store endpoint with validation
app.post(
  "/store",
  upload.single("file"),
  body("fileId")
    .trim()
    .isLength({ min: 1, max: 64 }),
  async (req, res) => {
    const startTime = Date.now();
    // Validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logPerformance("/store", startTime, Date.now(), "fail:invalidId");
      return res
        .status(400)
        .type("text/plain")
        .send("Invalid File ID (1-64 chars).");
    }

    try {
      const { fileId: rawId, storageType = ""} = req.body;
      const type = (storageType || "").toLowerCase();

      if (type !== "centralized" && type !== "ipfs") {
        logPerformance("/store", startTime, Date.now(), "fail:badType");
        return res
          .status(400)
          .type("text/plain")
          .send("Storage type invalid.");
      }

      const localFilePath = req.file?.path;
      if (!localFilePath) {
        logPerformance("/store", startTime, Date.now(), "fail:noFile");
        return res.status(400).send("No file uploaded.");
      }

      const { receipt, cid } = await storeData(rawId, localFilePath, type);

      try {
        fs.unlinkSync(localFilePath);
      } catch (unlinkErr) {
        console.warn("[WARN] Failed to remove temp file:", unlinkErr);
      }

      let timestamp = null;

      try {
        timestamp = await getTimestamp(rawId);
      } catch (_) {
      }
      
      logPerformance("/store", startTime, Date.now(), "success");
      return res.json({
        status: "ok",
        fileId: rawId,
        storageType: type,
        pointer: cid ?? null,
        txHash: receipt?.hash ?? receipt?.transactionHash ?? null,
        gasUsed: receipt?.gasUsed?.toString?.() ?? null,
        timestamp: timestamp !== null ? timestamp.toString() : null
      });
    } catch (err) {
      console.error(err);
      logPerformance("/store", startTime, Date.now(), "fail:exception");
      return res
        .status(500)
        .type("text/plain")
        .send(`Error storing file: ${err.message}`);
    }
  }
);

// Verify endpoint with validation
app.post(
  "/verify",
  upload.single("file"),
  body("fileId")
    .trim()
    .isLength({ min: 1, max: 64 }),
  async (req, res) => {
    const startTime = Date.now();
    // Validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logPerformance("/verify", startTime, Date.now(), "fail:invalidId");
      return res
        .status(400)
        .type("text/plain")
        .send("Invalid File ID; use only letters and numbers (max 64 chars).");
    }

    try {
      const rawId = req.body.fileId; 
      const localFilePath = req.file?.path;;
      if (!localFilePath) {
        logPerformance("/verify", startTime, Date.now(), "fail:noFile");
        return res.status(400).send("No file uploaded.");
      }

      
      let isMatch;
      try {
        isMatch = await verifyData(rawId, localFilePath)
        
      } catch (err) {
    
        if (err?.error?.data?.errorName === "DataNotFound" || /DataNotFound/i.test(err.message)) {
          logPerformance("/verify", startTime, Date.now(), "fail:notFound");
          return res.status(404).type("text/plain").send(`File ID "${rawId}" not anchored on-chain`);
        }
        throw err;
    }


      logPerformance("/verify", startTime, Date.now(), "success");
      return res.json({ fileId: rawId, match: isMatch });
    } catch (err) {
      console.error(err);
      logPerformance("/verify", startTime, Date.now(), "fail:exception");
      return res
        .status(500)
        .type("text/plain")
        .send(`Error verifying file: ${err.message}`);
    }
  }
);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});