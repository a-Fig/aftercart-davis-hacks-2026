#!/usr/bin/env node
/**
 * Smoke test for the local OFF SQLite database.
 * Exercises the helpers in web/lib/off/query.mjs against representative queries.
 *
 *   node web/scripts/test-off-query.mjs              # query the full DB
 *   node web/scripts/test-off-query.mjs --sample     # query the sample DB
 */

import { openOff, lookupByBarcode, search, productsByStore, productsInCategory, summary } from '../lib/off/query.mjs';

const SAMPLE = process.argv.includes('--sample');

const db = openOff({ sample: SAMPLE });

console.log('━━━ Summary ━━━');
const s = summary(db);
console.log(`  Products:       ${s.products.toLocaleString()}`);
console.log(`  Distinct cats:  ${s.categories.toLocaleString()}`);
console.log(`  Distinct stores:${s.stores.toLocaleString()}`);
console.log(`  Distinct labels:${s.labels.toLocaleString()}`);

console.log('\n━━━ Search: "boneless chicken thigh" ━━━');
for (const r of search(db, 'boneless chicken thigh', 5)) {
  console.log(`  [${r.score.toFixed(2)}] ${r.product_name} (${r.brands || '—'}) ${r.quantity_raw || ''}`);
}

console.log('\n━━━ Search: "whole milk" ━━━');
for (const r of search(db, 'whole milk', 5)) {
  console.log(`  [${r.score.toFixed(2)}] ${r.product_name} (${r.brands || '—'}) ${r.quantity_raw || ''}`);
}

console.log('\n━━━ Search: "organic blueberries" ━━━');
for (const r of search(db, 'organic blueberries', 5)) {
  console.log(`  [${r.score.toFixed(2)}] ${r.product_name} (${r.brands || '—'}) ${r.quantity_raw || ''}`);
}

console.log('\n━━━ Category: en:romaine-lettuce ━━━');
for (const r of productsInCategory(db, 'en:romaine-lettuce', 5)) {
  console.log(`  ${r.product_name} (${r.brands || '—'}) ${r.quantity_raw || ''}`);
}

console.log('\n━━━ Store tag: trader-joe-s (top 5) ━━━');
for (const r of productsByStore(db, 'trader-joe-s', 5)) {
  console.log(`  ${r.product_name} (${r.brands || '—'}) ${r.quantity_raw || ''}`);
}

console.log('\n━━━ Barcode lookup: 0078742370156 (Great Value Whole Milk) ━━━');
const oneProduct = lookupByBarcode(db, '0078742370156');
console.log(oneProduct ? JSON.stringify(oneProduct, null, 2) : '  not found');

// Latency micro-bench
console.log('\n━━━ Latency ━━━');
const N = 1000;
const t0 = Date.now();
for (let i = 0; i < N; i++) lookupByBarcode(db, '0078742370156');
console.log(`  ${N} barcode lookups in ${Date.now() - t0} ms (${((Date.now() - t0) / N).toFixed(3)} ms each)`);

const t1 = Date.now();
for (let i = 0; i < N; i++) search(db, 'whole milk', 5);
console.log(`  ${N} FTS searches in ${Date.now() - t1} ms (${((Date.now() - t1) / N).toFixed(3)} ms each)`);

db.close();
