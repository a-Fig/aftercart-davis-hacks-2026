'use client';

import { useState } from 'react';
import { THEMES } from './data';
import type { OffEnrichment, OffNutriments } from './data';

/**
 * Open Food Facts enrichment block rendered inside ItemDetailModal. Surfaces
 * factual product info (image, ingredients, allergens, per-100g nutriments)
 * AND scoring (Nutri-Score, NOVA group). Per the v1.2 product spec, scoring
 * is shown — we display the grade, we don't judge the user for what they buy.
 *
 * Data flows /api/compare → adapter → ReceiptItem.enrichment. When null, the
 * block is omitted entirely (no skeleton state).
 */

interface OffEnrichmentBlockProps {
  enrichment: OffEnrichment;
}

export default function OffEnrichmentBlock({ enrichment }: OffEnrichmentBlockProps) {
  const t = THEMES.forest;
  const [showIngredients, setShowIngredients] = useState(false);
  const [showAdditives, setShowAdditives] = useState(false);

  const hasScoring = !!(enrichment.nutriscore_grade || enrichment.nova_group || enrichment.ecoscore_grade);
  const hasComposition = !!(
    enrichment.ingredients_text
      || enrichment.allergens.length
      || enrichment.traces.length
      || enrichment.additives.length
  );
  const hasNutrition = hasAnyNutriment(enrichment.nutriments);

  const imageSrc = enrichment.image_url ?? (enrichment.barcode ? `/api/off-image/${enrichment.barcode}` : null);

  // If literally nothing is populated (rare — at minimum we usually have a name),
  // skip the entire block so the modal doesn't show an empty section.
  if (!imageSrc && !hasScoring && !hasComposition && !hasNutrition) {
    return null;
  }

  return (
    <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 16, marginTop: 4 }}>
      <div style={{ fontSize: 'var(--t-xs)', fontWeight: 600, color: t.inkFaint, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
        About this product
      </div>

      {/* Image + brand */}
      {imageSrc && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt={enrichment.product_name ?? 'product'}
            style={{ width: 80, height: 80, borderRadius: 12, objectFit: 'cover', background: t.surfaceAlt, flexShrink: 0 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            {enrichment.product_name && (
              <div style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: t.inkDark, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {enrichment.product_name}
              </div>
            )}
            {enrichment.brands && (
              <div style={{ fontSize: 'var(--t-xs)', color: t.inkLight, marginTop: 2 }}>
                {enrichment.brands}
              </div>
            )}
            {enrichment.serving_size && (
              <div style={{ fontSize: 'var(--t-xs)', color: t.inkFaint, marginTop: 4 }}>
                Serving: {enrichment.serving_size}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Scoring */}
      {hasScoring && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {enrichment.nutriscore_grade && <NutriScoreBadge grade={enrichment.nutriscore_grade} />}
          {enrichment.nova_group != null && <NovaBadge group={enrichment.nova_group} />}
          {enrichment.ecoscore_grade && <EcoScoreBadge grade={enrichment.ecoscore_grade} />}
        </div>
      )}

      {/* Allergens */}
      {enrichment.allergens.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 'var(--t-xs)', fontWeight: 600, color: '#a02828', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Contains
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {enrichment.allergens.map((a) => (
              <Chip key={a} label={prettifyTag(a)} bg="#fdecec" color="#a02828" border="#f5c0c0" />
            ))}
          </div>
        </div>
      )}

      {/* Traces */}
      {enrichment.traces.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 'var(--t-xs)', fontWeight: 600, color: '#9a6500', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            May contain
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {enrichment.traces.map((tr) => (
              <Chip key={tr} label={prettifyTag(tr)} bg="#fef6e1" color="#9a6500" border="#f0dcaf" />
            ))}
          </div>
        </div>
      )}

      {/* Per-100g nutrition */}
      {hasNutrition && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 'var(--t-xs)', fontWeight: 600, color: t.inkFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Per 100 g
          </div>
          <NutritionTable n={enrichment.nutriments} />
        </div>
      )}

      {/* Ingredients (collapsed) */}
      {enrichment.ingredients_text && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => setShowIngredients((v) => !v)}
            style={{
              padding: 0,
              background: 'transparent',
              border: 'none',
              color: t.accent,
              fontFamily: 'inherit',
              fontSize: 'var(--t-xs)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: 'pointer',
            }}
          >
            {showIngredients ? '− Hide ingredients' : '+ Show ingredients'}
          </button>
          {showIngredients && (
            <div style={{ fontSize: 'var(--t-sm)', color: t.inkLight, lineHeight: 1.55, marginTop: 6, padding: '8px 10px', background: t.surfaceAlt, borderRadius: 8 }}>
              {enrichment.ingredients_text}
            </div>
          )}
        </div>
      )}

      {/* Additives (collapsed) */}
      {enrichment.additives.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => setShowAdditives((v) => !v)}
            style={{
              padding: 0,
              background: 'transparent',
              border: 'none',
              color: t.accent,
              fontFamily: 'inherit',
              fontSize: 'var(--t-xs)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: 'pointer',
            }}
          >
            {showAdditives ? `− Hide additives (${enrichment.additives.length})` : `+ Show additives (${enrichment.additives.length})`}
          </button>
          {showAdditives && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {enrichment.additives.map((a) => (
                <Chip key={a} label={prettifyTag(a).toUpperCase()} bg="#f1f1f4" color="#5a5a78" border="#dcdce4" />
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 10, color: t.inkFaint, marginTop: 10 }}>
        Product data from <strong>Open Food Facts</strong>, a community-maintained database.
      </div>
    </div>
  );
}

// ── Score badges ───────────────────────────────────────────────────────────

function NutriScoreBadge({ grade }: { grade: 'a' | 'b' | 'c' | 'd' | 'e' }) {
  const colors: Record<string, string> = {
    a: '#1d7d3e', b: '#7eb53d', c: '#e8b22b', d: '#e07a2f', e: '#c93434',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#f8f8fb', borderRadius: 10, border: '1px solid #e6e6ee' }}>
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: colors[grade],
          color: '#fff',
          fontWeight: 800,
          fontSize: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          letterSpacing: '0.02em',
        }}
      >
        {grade.toUpperCase()}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Nutri-Score
        </span>
        <span style={{ fontSize: 'var(--t-xs)', color: '#444' }}>{nutriScoreLabel(grade)}</span>
      </div>
    </div>
  );
}

function NovaBadge({ group }: { group: 1 | 2 | 3 | 4 }) {
  // 1 = unprocessed, 4 = ultra-processed. Color-graded same direction as Nutri.
  const colors: Record<number, string> = { 1: '#1d7d3e', 2: '#7eb53d', 3: '#e8b22b', 4: '#c93434' };
  const labels: Record<number, string> = {
    1: 'Unprocessed',
    2: 'Processed culinary',
    3: 'Processed',
    4: 'Ultra-processed',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#f8f8fb', borderRadius: 10, border: '1px solid #e6e6ee' }}>
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: colors[group],
          color: '#fff',
          fontWeight: 800,
          fontSize: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {group}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          NOVA
        </span>
        <span style={{ fontSize: 'var(--t-xs)', color: '#444' }}>{labels[group]}</span>
      </div>
    </div>
  );
}

function EcoScoreBadge({ grade }: { grade: 'a' | 'b' | 'c' | 'd' | 'e' }) {
  const colors: Record<string, string> = {
    a: '#1d7d3e', b: '#7eb53d', c: '#e8b22b', d: '#e07a2f', e: '#c93434',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#f8f8fb', borderRadius: 10, border: '1px solid #e6e6ee' }}>
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: colors[grade],
          color: '#fff',
          fontWeight: 800,
          fontSize: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {grade.toUpperCase()}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Eco-Score
        </span>
        <span style={{ fontSize: 'var(--t-xs)', color: '#444' }}>Sustainability</span>
      </div>
    </div>
  );
}

function nutriScoreLabel(grade: string): string {
  const labels: Record<string, string> = {
    a: 'Best nutritional quality',
    b: 'Good',
    c: 'Average',
    d: 'Poor',
    e: 'Worst',
  };
  return labels[grade] ?? '';
}

// ── Nutrition table ────────────────────────────────────────────────────────

function NutritionTable({ n }: { n: OffNutriments }) {
  // The big-8 we extracted as columns. Show only fields that have a value;
  // skip null/undefined so the table doesn't have empty rows.
  const rows: Array<{ label: string; value: number; unit: string }> = [];
  if (typeof n.energy_kcal_100g === 'number')   rows.push({ label: 'Calories',       value: n.energy_kcal_100g,    unit: 'kcal' });
  if (typeof n.fat_100g === 'number')           rows.push({ label: 'Fat',            value: n.fat_100g,            unit: 'g' });
  if (typeof n.saturated_fat_100g === 'number') rows.push({ label: 'Saturated fat',  value: n.saturated_fat_100g,  unit: 'g' });
  if (typeof n.sugars_100g === 'number')        rows.push({ label: 'Sugars',         value: n.sugars_100g,         unit: 'g' });
  if (typeof n.fiber_100g === 'number')         rows.push({ label: 'Fiber',          value: n.fiber_100g,          unit: 'g' });
  if (typeof n.proteins_100g === 'number')      rows.push({ label: 'Protein',        value: n.proteins_100g,       unit: 'g' });
  // OFF stores sodium in g per 100g; surface in mg for legibility (most labels do).
  if (typeof n.sodium_100g === 'number')        rows.push({ label: 'Sodium',         value: n.sodium_100g * 1000,  unit: 'mg' });
  if (typeof n.salt_100g === 'number')          rows.push({ label: 'Salt',           value: n.salt_100g,           unit: 'g' });

  if (!rows.length) return null;

  return (
    <div style={{ background: '#f8f8fb', borderRadius: 10, padding: 10, border: '1px solid #e8e8f0' }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 'var(--t-sm)' }}>
          <span style={{ color: '#666' }}>{r.label}</span>
          <span style={{ color: '#222', fontWeight: 500 }}>{formatNum(r.value)} {r.unit}</span>
        </div>
      ))}
    </div>
  );
}

function hasAnyNutriment(n: OffNutriments): boolean {
  return [
    n.energy_kcal_100g, n.fat_100g, n.saturated_fat_100g, n.sugars_100g,
    n.fiber_100g, n.proteins_100g, n.sodium_100g, n.salt_100g,
  ].some((v) => typeof v === 'number');
}

function formatNum(n: number): string {
  if (n === 0) return '0';
  if (Math.abs(n) < 0.01) return n.toFixed(3);
  if (Math.abs(n) < 1) return n.toFixed(2);
  if (Math.abs(n) < 10) return n.toFixed(1);
  return Math.round(n).toString();
}

// ── chips + tag prettifiers ────────────────────────────────────────────────

function Chip({ label, bg, color, border }: { label: string; bg: string; color: string; border: string }) {
  return (
    <span
      style={{
        fontSize: 'var(--t-xs)',
        padding: '3px 8px',
        borderRadius: 6,
        background: bg,
        color,
        border: `1px solid ${border}`,
        fontWeight: 500,
      }}
    >
      {label}
    </span>
  );
}

/**
 * Convert OFF tag "en:peanuts" or "en:e211" to a human-readable label.
 * - Strips the "en:" language prefix
 * - Replaces dashes with spaces
 * - Capitalizes the first letter
 */
function prettifyTag(tag: string): string {
  const stripped = tag.replace(/^[a-z]{2}:/, '');
  const spaced = stripped.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
