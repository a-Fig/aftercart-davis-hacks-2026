#!/usr/bin/env node
/**
 * Downloads ALL price data from Open Food Facts Prices (prices.openfoodfacts.org)
 * for US locations. Saves raw JSONL to data/off-prices/us-prices.jsonl.
 *
 * Run from repo root:
 *   node web/scripts/download-off-prices.mjs              # download all US prices
 *   node web/scripts/download-off-prices.mjs --resume     # resume from last downloaded page
 *   node web/scripts/download-off-prices.mjs --limit 500  # cap at N records (testing)
 *
 * Also downloads US locations to data/off-prices/us-locations.jsonl.
 *
 * Rate limit: 15 req/min → 4s between requests.
 * At size=100, ~268 pages ≈ 18 minutes for the full dataset.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const OUT_DIR = join(ROOT, 'data', 'off-prices');

const args = process.argv.slice(2);
const RESUME = args.includes('--resume');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

const PRICES_FILE = join(OUT_DIR, 'us-prices.jsonl');
const LOCATIONS_FILE = join(OUT_DIR, 'us-locations.jsonl');
const STATE_FILE = join(OUT_DIR, 'download-state.json');

const API_BASE = 'https://prices.openfoodfacts.org/api/v1';
const PAGE_SIZE = 100;
const DELAY_MS = 4000;

const delay = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(endpoint, params, retries = 3) {
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'AfterCart/1.0 (grocery price comparison tool; tylerd2474@gmail.com)' }
      });
      if (res.status === 429) {
        const wait = attempt * 10000;
        console.log(`  Rate limited (429). Waiting ${wait / 1000}s before retry ${attempt}/${retries}...`);
        await delay(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`  Fetch error: ${err.message}. Retry ${attempt}/${retries} in 5s...`);
      await delay(5000);
    }
  }
}

function loadState() {
  if (RESUME && existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  }
  return { pricesPage: 1, pricesTotal: 0, pricesFetched: 0, locationsPage: 1, locationsTotal: 0, locationsFetched: 0, phase: 'prices' };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function downloadPrices(state) {
  console.log('\n=== Downloading US Prices ===');

  const appendMode = RESUME && state.pricesPage > 1;
  if (!appendMode) {
    writeFileSync(PRICES_FILE, '');
  }

  let page = state.pricesPage;
  let fetched = state.pricesFetched;
  let totalPages = null;

  while (true) {
    if (fetched >= LIMIT) {
      console.log(`\nReached --limit of ${LIMIT} records. Stopping.`);
      break;
    }

    const data = await fetchPage('prices', {
      country_code: 'US',
      currency: 'USD',
      order_by: '-date',
      size: String(PAGE_SIZE),
      page: String(page)
    });

    if (page === state.pricesPage || !totalPages) {
      totalPages = data.pages;
      state.pricesTotal = data.total;
      console.log(`Total US prices: ${data.total} across ${data.pages} pages\n`);
    }

    if (!data.items || data.items.length === 0) {
      console.log('No more items. Done.');
      break;
    }

    let lines = '';
    for (const item of data.items) {
      lines += JSON.stringify(item) + '\n';
      fetched++;
      if (fetched >= LIMIT) break;
    }
    appendFileSync(PRICES_FILE, lines);

    const pct = totalPages ? ((page / totalPages) * 100).toFixed(1) : '?';
    console.log(`  Page ${page}/${totalPages} — ${data.items.length} items — ${fetched} total (${pct}%)`);

    state.pricesPage = page + 1;
    state.pricesFetched = fetched;
    saveState(state);

    page++;
    if (page > totalPages) break;

    await delay(DELAY_MS);
  }

  console.log(`\nPrices download complete: ${fetched} records → ${PRICES_FILE}`);
  state.phase = 'locations';
  saveState(state);
  return fetched;
}

async function downloadLocations(state) {
  console.log('\n=== Downloading US Locations ===');

  const appendMode = RESUME && state.locationsPage > 1;
  if (!appendMode) {
    writeFileSync(LOCATIONS_FILE, '');
  }

  let page = state.locationsPage;
  let fetched = state.locationsFetched;
  let totalPages = null;

  while (true) {
    const data = await fetchPage('locations', {
      osm_address_country__code: 'US',
      order_by: '-price_count',
      size: String(PAGE_SIZE),
      page: String(page)
    });

    if (page === state.locationsPage || !totalPages) {
      totalPages = data.pages;
      state.locationsTotal = data.total;
      console.log(`Total US locations: ${data.total} across ${data.pages} pages\n`);
    }

    if (!data.items || data.items.length === 0) {
      console.log('No more items. Done.');
      break;
    }

    let lines = '';
    for (const item of data.items) {
      lines += JSON.stringify(item) + '\n';
      fetched++;
    }
    appendFileSync(LOCATIONS_FILE, lines);

    const pct = totalPages ? ((page / totalPages) * 100).toFixed(1) : '?';
    console.log(`  Page ${page}/${totalPages} — ${data.items.length} locations — ${fetched} total (${pct}%)`);

    state.locationsPage = page + 1;
    state.locationsFetched = fetched;
    saveState(state);

    page++;
    if (page > totalPages) break;

    await delay(DELAY_MS);
  }

  console.log(`\nLocations download complete: ${fetched} records → ${LOCATIONS_FILE}`);
  state.phase = 'done';
  saveState(state);
  return fetched;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('Open Food Facts Prices — US Data Download');
  console.log(`Output: ${OUT_DIR}`);
  if (RESUME) console.log('Resume mode: continuing from last checkpoint');
  if (LIMIT < Infinity) console.log(`Limit: ${LIMIT} price records`);

  const state = loadState();

  if (state.phase !== 'done' && state.phase !== 'locations') {
    await downloadPrices(state);
  } else if (state.phase === 'prices') {
    // already done
  }

  if (state.phase === 'locations' || state.phase === 'prices') {
    await downloadLocations(state);
  }

  // Print summary
  console.log('\n=== Summary ===');
  console.log(`Prices:    ${state.pricesFetched} records (${state.pricesTotal} available)`);
  console.log(`Locations: ${state.locationsFetched} records (${state.locationsTotal} available)`);
  console.log(`Files:     ${PRICES_FILE}`);
  console.log(`           ${LOCATIONS_FILE}`);
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  console.log('Re-run with --resume to continue from last checkpoint.');
  process.exit(1);
});
