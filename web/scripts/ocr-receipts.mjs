/**
 * OCR a folder of receipt images and run the parser.
 *
 * Usage (from repo root):
 *   node web/scripts/ocr-receipts.mjs                        # Vision API + heuristic parser (default: ./receipts/inbox/)
 *   node web/scripts/ocr-receipts.mjs --gpt                  # GPT parser via OpenRouter
 *   node web/scripts/ocr-receipts.mjs path/to/folder
 *   node web/scripts/ocr-receipts.mjs --gpt path/to/file.jpg
 *
 * Vision mode outputs to ./tmp/ocr-output/<basename>/:
 *   full-text.txt        — raw OCR text from Google Vision
 *   parsed.json          — heuristic ParsedReceipt
 *   vision-summary.json  — block count, page confidence, image hash
 *
 * GPT mode outputs to ./tmp/gpt-output/<basename>/:
 *   parsed.json          — ReceiptOutput JSON (strict schema, no normalization)
 *   warnings.txt         — schema validation warnings (only written if non-empty)
 *
 * Both modes cache responses by SHA-256 image hash, so re-runs after
 * code changes don't re-bill the API.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname, basename, extname, join } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { parseReceipt } from "../lib/receipts/parse.mjs";
import { processReceipt } from "../lib/receipts/gpt-parser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const TMP = resolve(ROOT, "tmp");
const CACHE_DIR = resolve(TMP, "ocr-cache");
const OUTPUT_DIR = resolve(TMP, "ocr-output");
const GPT_CACHE_DIR = resolve(TMP, "gpt-cache");
const GPT_OUTPUT_DIR = resolve(TMP, "gpt-output");

// ── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isGpt = args.includes("--gpt");
const pathArg = args.find((a) => !a.startsWith("--"));
const target = resolve(pathArg || join(ROOT, "receipts", "inbox"));

// ── Env ─────────────────────────────────────────────────────────────────────

function readEnv(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return env;
}

const env = readEnv(resolve(__dirname, "..", ".env.local"));

if (isGpt) {
  if (!env.OPENROUTER_KEY) {
    console.error("Missing OPENROUTER_KEY in web/.env.local");
    process.exit(1);
  }
  // GOOGLE_VISION_API_KEY is optional in --gpt mode: when set, we run Vision
  // OCR + parse.mjs heuristic to detect the chain upfront, skipping the GPT
  // detectStore call. Without it we fall back to a GPT detect call.
} else {
  if (!env.GOOGLE_VISION_API_KEY) {
    console.error("Missing GOOGLE_VISION_API_KEY in web/.env.local");
    process.exit(1);
  }
}

// ── Image discovery ─────────────────────────────────────────────────────────

function listImages(p) {
  if (!existsSync(p)) {
    console.error(`Path not found: ${p}`);
    process.exit(1);
  }
  const stat = statSync(p);
  if (stat.isFile()) return [p];
  return readdirSync(p)
    .filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f))
    .map((f) => join(p, f))
    .sort();
}

// ── Vision helpers ───────────────────────────────────────────────────────────

async function ocrImage(imagePath) {
  const bytes = readFileSync(imagePath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const cacheFile = join(CACHE_DIR, `${hash}.json`);

  if (existsSync(cacheFile)) {
    return { hash, response: JSON.parse(readFileSync(cacheFile, "utf8")), cached: true };
  }

  const body = {
    requests: [
      {
        image: { content: bytes.toString("base64") },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        imageContext: { languageHints: ["en"] },
      },
    ],
  };

  const url = `https://vision.googleapis.com/v1/images:annotate?key=${env.GOOGLE_VISION_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vision API ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  if (json.responses?.[0]?.error) {
    throw new Error(`Vision error: ${JSON.stringify(json.responses[0].error)}`);
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(json, null, 2));
  return { hash, response: json, cached: false };
}

function summarizeVision(response, hash) {
  const r = response.responses?.[0] || {};
  const fta = r.fullTextAnnotation || {};
  const pages = fta.pages || [];
  const blockCount = pages.reduce((acc, p) => acc + (p.blocks?.length || 0), 0);
  const pageConfidence =
    pages.length > 0 && typeof pages[0].confidence === "number" ? pages[0].confidence : null;
  const detectedLanguages = pages[0]?.property?.detectedLanguages || [];
  return {
    image_hash: hash,
    page_count: pages.length,
    block_count: blockCount,
    page_confidence: pageConfidence,
    detected_languages: detectedLanguages,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

const images = listImages(target);
console.log(`Found ${images.length} image(s) under ${target}`);
console.log(`Mode: ${isGpt ? "GPT (OpenRouter)" : "Vision API + heuristic parser"}\n`);

const summaryRows = [];

if (isGpt) {
  mkdirSync(GPT_OUTPUT_DIR, { recursive: true });

  for (const imgPath of images) {
    const name = basename(imgPath, extname(imgPath));
    const outDir = join(GPT_OUTPUT_DIR, name);
    mkdirSync(outDir, { recursive: true });

    let row;
    try {
      const bytes = readFileSync(imgPath);
      const base64 = bytes.toString("base64");

      // Use Vision OCR + heuristic parser as a fast/free chain detector.
      // Skips the GPT detectStore call entirely for known chains.
      let chainHint = null;
      let visionCached = null;
      if (env.GOOGLE_VISION_API_KEY) {
        try {
          const v = await ocrImage(imgPath);
          visionCached = v.cached;
          const text = v.response.responses?.[0]?.fullTextAnnotation?.text || "";
          chainHint = parseReceipt(text).store_name;
        } catch {
          // Vision unavailable; processReceipt will fall back to GPT detect.
        }
      }

      const { chain, parsed, warnings, cached } = await processReceipt(
        base64,
        env.OPENROUTER_KEY,
        { chainHint },
      );

      writeFileSync(join(outDir, "parsed.json"), JSON.stringify(parsed, null, 2));
      if (warnings.length > 0) {
        writeFileSync(join(outDir, "warnings.txt"), warnings.join("\n") + "\n");
      }

      const compareItems = (parsed.items ?? []).filter((i) => i.item_type !== "skip");
      const cachedTag = cached
        ? (visionCached === false ? "Y*" : "Y")  // Y* = GPT cached, Vision fresh
        : (visionCached ? "N*" : "N");           // N* = GPT fresh, Vision cached
      row = {
        file: basename(imgPath),
        cached: cachedTag,
        detect: chainHint ? "heuristic" : "gpt",
        store: parsed.store_name ?? chain ?? "?",
        items: compareItems.length,
        total: parsed.receipt_total != null ? `$${parsed.receipt_total.toFixed(2)}` : "?",
        count: parsed.item_count != null ? String(parsed.item_count) : "?",
        warn: warnings.length || "",
      };
    } catch (err) {
      row = {
        file: basename(imgPath),
        cached: "-",
        detect: "-",
        store: "ERROR",
        items: 0,
        total: "-",
        count: "-",
        error: err.message,
      };
    }
    summaryRows.push(row);
  }

  const cols = [
    ["file", 24],
    ["cached", 6],
    ["detect", 9],
    ["store", 18],
    ["items", 5],
    ["total", 9],
    ["count", 7],
    ["warn", 5],
  ];
  console.log(cols.map(([k, w]) => k.padEnd(w)).join("  "));
  console.log(cols.map(([, w]) => "-".repeat(w)).join("  "));
  for (const r of summaryRows) {
    console.log(cols.map(([k, w]) => String(r[k] ?? "").padEnd(w)).join("  "));
    if (r.error) console.log(`  ↳ ${r.error}`);
  }
  console.log(`\nOutputs in ${GPT_OUTPUT_DIR}`);
} else {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const imgPath of images) {
    const name = basename(imgPath, extname(imgPath));
    const outDir = join(OUTPUT_DIR, name);
    mkdirSync(outDir, { recursive: true });

    let row;
    try {
      const { hash, response, cached } = await ocrImage(imgPath);
      const text = response.responses?.[0]?.fullTextAnnotation?.text || "";
      const parsed = parseReceipt(text);
      const visionSummary = summarizeVision(response, hash);

      writeFileSync(join(outDir, "full-text.txt"), text);
      writeFileSync(join(outDir, "parsed.json"), JSON.stringify(parsed, null, 2));
      writeFileSync(join(outDir, "vision-summary.json"), JSON.stringify(visionSummary, null, 2));

      row = {
        file: basename(imgPath),
        cached: cached ? "Y" : "N",
        store: parsed.store_name || "?",
        items: parsed.items.length,
        total: parsed.receipt_total !== null ? `$${parsed.receipt_total.toFixed(2)}` : "?",
        unparsed: parsed.unparsed_lines.length,
      };
    } catch (err) {
      row = {
        file: basename(imgPath),
        cached: "-",
        store: "ERROR",
        items: 0,
        total: "-",
        unparsed: 0,
        error: err.message,
      };
    }
    summaryRows.push(row);
  }

  const cols = [
    ["file", 24],
    ["cached", 6],
    ["store", 18],
    ["items", 5],
    ["total", 9],
    ["unparsed", 8],
  ];
  console.log(cols.map(([k, w]) => k.padEnd(w)).join("  "));
  console.log(cols.map(([, w]) => "-".repeat(w)).join("  "));
  for (const r of summaryRows) {
    console.log(cols.map(([k, w]) => String(r[k] ?? "").padEnd(w)).join("  "));
    if (r.error) console.log(`  ↳ ${r.error}`);
  }
  console.log(`\nOutputs in ${OUTPUT_DIR}`);
}
