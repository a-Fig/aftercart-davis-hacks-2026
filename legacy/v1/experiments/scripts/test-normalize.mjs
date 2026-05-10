import { normalizeDescription } from '../lib/normalize.mjs'

const samples = [
  'BFLS CKNG THGH 2.13LB',
  'KS WLD BLBRY',
  'KS ORG EGGS',
  'WHL ORG MLK 1GAL',
  'COOKIES SEA SALT CHOC CH',
  'POUND PLUS DK CHOC 72%',
  '**KS BATH**',
  'GINOS EAST DEEP',
  'ORG RASPBERY',
  'FAGE GRK 48Z',
  '1 2% MILK',
  'First Street Garbanzo B',
  'BUNNY TOMMY MANGO',
  'COCKTAIL TOMATOES',
  'CAPUTA FLOUR',
  'PLANTAIN CHIPS JERK STYL',
  'SPINACH & ARTICHOKE DIP',
  'HABANERO PEPPER',
  'MEXICAN PAPAYA',
  'WYMANS WILD',
  'SOFTSOAP',
]

for (const s of samples) {
  const r = normalizeDescription(s)
  const sizes = r.sizes.length ? ` sizes=${JSON.stringify(r.sizes)}` : ''
  const brand = r.brand ? ` brand=${r.brand}` : ''
  const org = r.is_organic ? ' [organic]' : ''
  const sb = r.is_store_brand ? ' [store-brand]' : ''
  console.log(`${s.padEnd(30)} → "${r.normalized}"${brand}${org}${sb}${sizes}`)
}
