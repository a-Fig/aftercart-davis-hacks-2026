/**
 * Phase 1 — Chains and stores from the USDA SNAP Retailer Locator (ArcGIS)
 * Output: db/seed/01_chains_stores.sql
 *
 * Run from repo root: node web/scripts/seed-1-stores.mjs
 */

import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { SEED_DIR, esc } from './seed-utils.mjs'

const SERVICE = 'https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/snap_retailer_location_data/FeatureServer/0/query'
const BBOX = '-123.0,37.1,-121.4,39.0'
const STORE_TYPES = `Store_Type IN ('Supermarket','Super Store','Grocery Store','Other') AND State = 'CA'`

const CHAINS = [
  { patterns: ['WAL-MART', 'WALMART'],                  name: "Walmart",          parent: "Walmart Inc.",        model: 'chain_uniform' },
  { patterns: ['TARGET'],                                name: "Target",           parent: "Target Corporation",  model: 'regional' },
  { patterns: ['COSTCO'],                                name: "Costco",           parent: "Costco Wholesale",    model: 'chain_uniform' },
  { patterns: ['WHOLE FOOD', 'WFM '],                   name: "Whole Foods",      parent: "Amazon",              model: 'regional' },
  { patterns: ["TRADER JOE"],                            name: "Trader Joe's",     parent: "Aldi Nord",           model: 'chain_uniform' },
  { patterns: ['NUGGET'],                                name: "Nugget Markets",   parent: "Nugget Markets Inc.", model: 'regional' },
  { patterns: ['SAFEWAY'],                               name: "Safeway",          parent: "Albertsons",          model: 'regional' },
  { patterns: ['GROCERY OUTLET'],                        name: "Grocery Outlet",   parent: "Grocery Outlet Inc.", model: 'per_store' },
  { patterns: ['DAVIS FOOD', 'DAVIS CO-OP', 'DAVIS COOP'], name: "Davis Food Co-op", parent: "Davis Food Co-op", model: 'per_store' },
]

function matchChain(storeName) {
  const up = storeName.toUpperCase()
  for (const c of CHAINS) {
    if (c.patterns.some(p => up.includes(p))) return c
  }
  return null
}

async function fetchPage(offset) {
  const url = new URL(SERVICE)
  url.searchParams.set('where', STORE_TYPES)
  url.searchParams.set('geometry', BBOX)
  url.searchParams.set('geometryType', 'esriGeometryEnvelope')
  url.searchParams.set('inSR', '4326')
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects')
  url.searchParams.set('outFields', 'Store_Name,Store_Street_Address,City,State,Zip_Code,Store_Type,Latitude,Longitude,Record_ID')
  url.searchParams.set('resultOffset', String(offset))
  url.searchParams.set('resultRecordCount', '1000')
  url.searchParams.set('f', 'json')
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

async function fetchAll() {
  const all = []
  let offset = 0
  while (true) {
    console.log(`  Fetching offset ${offset}...`)
    const page = await fetchPage(offset)
    if (page.error) throw new Error(JSON.stringify(page.error))
    const features = page.features || []
    all.push(...features)
    if (!page.exceededTransferLimit) break
    offset += 1000
  }
  return all
}

const features = await fetchAll()
console.log(`Fetched ${features.length} stores. Filtering to target chains...`)

const matched = []
for (const f of features) {
  const a = f.attributes
  const chain = matchChain(a.Store_Name)
  if (!chain) continue
  const address = [a.Store_Street_Address, a.City, a.State, a.Zip_Code].filter(Boolean).join(', ')
  matched.push({ chain, name: a.Store_Name, address, lat: a.Latitude, lon: a.Longitude, record_id: a.Record_ID })
}

// Deduplicate by (chain, address)
const seen = new Set()
const stores = matched.filter(s => {
  const key = `${s.chain.name}|${s.address}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})

const chainNames = [...new Set(stores.map(s => s.chain.name))]
console.log(`Matched ${stores.length} stores across chains: ${chainNames.join(', ')}`)

// ── Build SQL ──────────────────────────────────────────────────────────────

const usedChains = CHAINS.filter(c => chainNames.includes(c.name))

const chainRows = usedChains.map(c =>
  `  (${esc(c.name)}, ${esc(c.parent)}, TRUE, ${esc(c.model)})`
).join(',\n')

const storeRows = stores.map(s =>
  `  ((SELECT chain_id FROM chains WHERE name=${esc(s.chain.name)}), ` +
  `${esc(s.name)}, ${esc(s.address)}, ` +
  `ST_SetSRID(ST_MakePoint(${s.lon}, ${s.lat}), 4326)::geography, ` +
  `TRUE, ${esc(String(s.record_id))})`
).join(',\n')

const sql = `-- ============================================================
-- Phase 1: Chains and stores from USDA SNAP Retailer Locator
-- Generated: ${new Date().toISOString()}
-- Stores: ${stores.length} across ${usedChains.length} chains
-- ============================================================

INSERT INTO chains (name, parent_company, snap_authorized, pricing_model) VALUES
${chainRows}
ON CONFLICT (name) DO NOTHING;

INSERT INTO stores (chain_id, external_id, address, location, snap_authorized, usda_retailer_id) VALUES
${storeRows}
ON CONFLICT (chain_id, external_id) DO NOTHING;
`

const out = resolve(SEED_DIR, '01_chains_stores.sql')
writeFileSync(out, sql, 'utf8')
console.log(`✓ Wrote ${out}`)
console.log(`  ${usedChains.length} chains, ${stores.length} stores`)
