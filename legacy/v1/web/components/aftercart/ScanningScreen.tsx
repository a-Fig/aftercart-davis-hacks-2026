'use client';

import { useState, useEffect, useRef } from 'react';
import { THEMES } from './data';
import { matchReceipt, type MatchResponse } from '@/lib/api/compare';

// Phase 3 was "Comparing prices…" before the v1.2 split. Now matching is the
// last server-side step before the user reviews — price comparison happens
// after the user confirms in ReviewScreen.
const PHASE_LABELS = ['Reading receipt…', 'Extracting items…', 'Matching products…'];

interface ScanningScreenProps {
  file: File | null;
  onDone: (result: MatchResponse) => void;
  onCancel: () => void;
}

export default function ScanningScreen({ file, onDone, onCancel }: ScanningScreenProps) {
  const t = THEMES.forest;
  const [phase, setPhase] = useState(0);
  const [foundItems, setFoundItems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Latest-ref pattern: the parent passes inline arrows for onDone/onCancel,
  // so their identity changes every render. Stash them in refs and keep the
  // effect dependency list down to [file] — otherwise every parent re-render
  // triggers a cleanup/abort cycle and the in-flight request dies before it
  // finishes. (We had this exact freeze.)
  const onDoneRef = useRef(onDone);
  const onCancelRef = useRef(onCancel);
  useEffect(() => { onDoneRef.current = onDone; onCancelRef.current = onCancel; });

  useEffect(() => {
    if (!file) {
      // No file (e.g. user navigated here directly) — bail back home.
      onCancelRef.current();
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    // Phase progression is best-effort: phases 0/1 advance on a short timer
    // because we don't get progress events from the route, and phase 2
    // (matching) lights up while we wait for the response. The phases stop
    // advancing as soon as we get a real result back so the labels don't
    // out-pace reality.
    const t1 = setTimeout(() => { if (!cancelled) setPhase(1); }, 1500);
    const t2 = setTimeout(() => { if (!cancelled) setPhase(2); }, 4000);

    (async () => {
      try {
        const result = await matchReceipt(file, { signal: controller.signal });
        if (cancelled) return;

        // Animate the matched items into the receipt mockup so users see
        // something concrete coming back. Use the in-house matcher's pick when
        // it has one; fall back to the receipt-side description so the
        // animation never goes blank for low-confidence items.
        const previews = result.items
          .filter((i) => i.item_type !== 'skip')
          .map((i) => i.suggested_match?.name ?? i.description);
        for (const item of previews) {
          if (cancelled) return;
          setFoundItems((prev) => [...prev, item]);
          await new Promise((r) => setTimeout(r, 110));
        }

        if (cancelled) return;
        // Hold for a brief moment so the final phase label is visible, then
        // hand the match payload up — parent transitions to ReviewScreen.
        setTimeout(() => { if (!cancelled) onDoneRef.current(result); }, 320);
      } catch (err) {
        if (cancelled || (err as Error).name === 'AbortError') return;
        setError((err as Error).message || 'Something went wrong');
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [file]);

  const totalKnown = foundItems.length || 0;
  const progress = phase === 2 ? Math.min(95, 40 + totalKnown * 6) : phase === 1 ? 25 : 8;

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: t.navBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 32px', color: '#fff' }}>
        <div style={{ fontFamily: 'var(--font-dm-serif), DM Serif Display, serif', fontSize: 'var(--t-lg)', marginBottom: 12, textAlign: 'center' }}>
          Couldn&apos;t read that receipt
        </div>
        <div style={{ fontSize: 'var(--t-sm)', color: 'rgba(255,255,255,0.65)', marginBottom: 24, textAlign: 'center', lineHeight: 1.5, maxWidth: 320 }}>
          {error}
        </div>
        <button
          onClick={onCancel}
          style={{ padding: '12px 28px', borderRadius: 12, border: '1.5px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#fff', fontFamily: 'inherit', fontSize: 'var(--t-sm)', fontWeight: 600, cursor: 'pointer' }}
        >
          Try a different photo
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: t.navBg, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '56px 24px 40px' }}>
      {/* Receipt mockup */}
      <div style={{ width: 170, height: 230, background: '#fff', borderRadius: 6, boxShadow: '0 10px 48px rgba(0,0,0,0.55)', position: 'relative', overflow: 'hidden', marginBottom: 36 }}>
        {phase < 2 && (
          <div style={{ position: 'absolute', left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${t.scanAccent}, transparent)`, animation: 'scanLine 1s ease-in-out infinite', boxShadow: `0 0 8px ${t.scanAccent}` }} />
        )}
        <div style={{ padding: '14px 12px', fontFamily: 'monospace', fontSize: 7, color: '#222', lineHeight: 1.9 }}>
          <div style={{ fontWeight: 700, textAlign: 'center', marginBottom: 4 }}>RECEIPT</div>
          <div style={{ textAlign: 'center', marginBottom: 6, color: '#777', fontSize: 6 }}>scanning…</div>
          {foundItems.map((item, idx) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', animation: 'fadeIn 0.3s ease' }}>
              <span style={{ overflow: 'hidden', maxWidth: 110, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {item.toUpperCase().slice(0, 16)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontFamily: 'var(--font-dm-serif), DM Serif Display, serif', fontSize: 'var(--t-lg)', color: '#fff', marginBottom: 6, animation: 'fadeIn 0.3s ease' }}>
        {PHASE_LABELS[phase]}
      </div>
      <div style={{ fontSize: 'var(--t-sm)', color: 'rgba(255,255,255,0.45)', marginBottom: 28 }}>
        {totalKnown > 0 ? `${totalKnown} item${totalKnown === 1 ? '' : 's'} found` : 'analyzing image'}
      </div>

      <div style={{ width: '100%', maxWidth: 260, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${progress}%`, background: t.scanAccent, borderRadius: 2, transition: 'width 0.36s ease' }} />
      </div>

      <div style={{ marginTop: 28, width: '100%', maxWidth: 260 }}>
        {foundItems.slice(-3).map((item, i) => (
          <div key={`${item}-${i}`} style={{ color: 'rgba(255,255,255,0.55)', fontSize: 'var(--t-sm)', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', animation: 'fadeUp 0.3s ease', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: t.scanAccent, flexShrink: 0 }} />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
