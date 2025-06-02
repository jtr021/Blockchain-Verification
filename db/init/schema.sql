CREATE DATABASE IF NOT EXISTS data_integrity;
USE data_integrity;

CREATE TABLE IF NOT EXISTS files (
  id VARCHAR(255) PRIMARY KEY,
  originalName TEXT,
  checksum TEXT,
  storageType ENUM('mysql','ipfs'),
  file_blob LONGBLOB,
  cid TEXT,
  timestamp DATETIME
);
