#!/usr/bin/env node
/**
 * Cloud Run startup script: download the OFF SQLite from GCS to /tmp
 * before starting the Next.js server.
 *
 * Uses the GCS JSON API with the instance metadata token (ADC) — no gcloud
 * CLI needed in the container image.
 *
 * Usage (Dockerfile CMD):
 *   node scripts/download-off-startup.mjs && node server.js
 */

import { createWriteStream, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';

const GCS_PATH = process.env.OFF_GCS_PATH || 'gs://aftercart-off-data/us-products.sqlite';
const LOCAL_PATH = process.env.OFF_SQLITE_PATH || '/tmp/us-products.sqlite';
const TMP_PATH = LOCAL_PATH + '.downloading';

if (existsSync(LOCAL_PATH)) {
  const size = statSync(LOCAL_PATH).size;
  console.log(`[off-startup] ${LOCAL_PATH} already exists (${(size / 1e9).toFixed(2)} GB), skipping download`);
  process.exit(0);
}

const match = GCS_PATH.match(/^gs:\/\/([^/]+)\/(.+)$/);
if (!match) {
  console.error(`[off-startup] Invalid GCS path: ${GCS_PATH}`);
  process.exit(0);
}
const [, bucket, object] = match;

async function getAccessToken() {
  return new Promise((resolve, reject) => {
    httpGet(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' } },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body).access_token);
          } catch (e) {
            reject(new Error(`Failed to parse token: ${body}`));
          }
        });
      }
    ).on('error', reject);
  });
}

async function download(token) {
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media`;
  return new Promise((resolve, reject) => {
    httpsGet(url, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => reject(new Error(`GCS returned ${res.statusCode}: ${body}`)));
        return;
      }
      const ws = createWriteStream(TMP_PATH);
      res.pipe(ws);
      ws.on('finish', () => {
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    }).on('error', reject);
  });
}

console.log(`[off-startup] Downloading ${GCS_PATH} → ${LOCAL_PATH} ...`);
const start = Date.now();

try {
  const token = await getAccessToken();
  await download(token);
  renameSync(TMP_PATH, LOCAL_PATH);
  const size = statSync(LOCAL_PATH).size;
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[off-startup] Done: ${(size / 1e9).toFixed(2)} GB in ${elapsed}s`);
} catch (err) {
  console.error(`[off-startup] Failed to download OFF SQLite: ${err.message}`);
  console.error('[off-startup] OFF enrichment will be unavailable (getSharedOff returns null)');
  try { unlinkSync(TMP_PATH); } catch {}
  process.exit(0);
}
