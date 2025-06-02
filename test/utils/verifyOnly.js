#!/usr/bin/env node

import axios from 'axios';
import FormData from 'form-data';
import { readFileSync } from 'fs';
import { basename } from 'path';

const [, , backend, filePath, fileId] = process.argv;
if (!backend || !filePath || !fileId) {
  console.error('Usage: verifyOnly.js <backend> <file> <fileId>');
  process.exit(1);
}

const fd = new FormData();
fd.append('file', readFileSync(filePath), basename(filePath));
fd.append('fileId', fileId);

const t0 = Date.now();
const res = await axios.post('http://localhost:3000/verify', fd, {
  headers: fd.getHeaders(),
  validateStatus: () => true
});
const verifyLatency = Date.now() - t0;

console.log(
  JSON.stringify({
    backend,
    file: basename(filePath),
    fileId,
    verifyLatency,
    verifyResult: res.data?.valid ?? false,
    status: res.status
  })
);
