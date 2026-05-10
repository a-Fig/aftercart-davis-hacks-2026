'use client';

import { useState, useEffect, useRef } from 'react';
import { V3 } from './theme';
import { matchReceipt, type MatchResponse } from '@/lib/api/compare';

const PHASES = ['Reading receipt', 'Extracting items', 'Matching products', 'Comparing prices'];

interface V3ScanProps {
  file: File | null;
  comparing: boolean;
  onDone: (result: MatchResponse) => void;
  onCancel: () => void;
}

export default function V3Scan({ file, comparing, onDone, onCancel }: V3ScanProps) {
  const [phase, setPhase] = useState(0);
  const [foundItems, setFoundItems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onDoneRef = useRef(onDone);
  const onCancelRef = useRef(onCancel);
  useEffect(() => { onDoneRef.current = onDone; onCancelRef.current = onCancel; });

  useEffect(() => {
    if (!file) { onCancelRef.current(); return; }

    let cancelled = false;
    const controller = new AbortController();

    const t1 = setTimeout(() => { if (!cancelled) setPhase(1); }, 1500);
    const t2 = setTimeout(() => { if (!cancelled) setPhase(2); }, 4000);

    (async () => {
      try {
        const result = await matchReceipt(file, { signal: controller.signal });
        if (cancelled) return;

        const previews = result.items
          .filter((i) => i.item_type !== 'skip')
          .map((i) => i.suggested_match?.name ?? i.description);

        for (const item of previews) {
          if (cancelled) return;
          setFoundItems((prev) => [...prev, item]);
          await new Promise((r) => setTimeout(r, 70));
        }

        if (cancelled) return;
        setTimeout(() => { if (!cancelled) onDoneRef.current(result); }, 240);
      } catch (err) {
        if (cancelled || (err as Error).name === 'AbortError') return;
        setError((err as Error).message || 'Something went wrong');
      }
    })();

    return () => { cancelled = true; controller.abort(); clearTimeout(t1); clearTimeout(t2); };
  }, [file]);

  // Once we hand the result up, V3App calls /api/compare; show that as phase 3.
  const effectivePhase = comparing ? 3 : phase;

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 28 }}>
        <div style={{ maxWidth: 380, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Couldn&apos;t read that receipt</div>
          <div style={{ fontSize: 14, color: V3.inkLight, marginBottom: 20 }}>{error}</div>
          <button
            onClick={onCancel}
            style={{
              padding: '12px 24px',
              borderRadius: 12,
              border: `1px solid ${V3.borderHi}`,
              background: 'transparent',
              color: V3.ink,
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try a different photo
          </button>
        </div>
      </div>
    );
  }

  const progress = Math.min(96, 6 + effectivePhase * 24 + foundItems.length * 3);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28, position: 'relative' }}>
      <button
        onClick={onCancel}
        style={{
          position: 'absolute',
          top: 22,
          right: 24,
          background: 'transparent',
          color: V3.inkLight,
          border: `1px solid ${V3.border}`,
          borderRadius: 999,
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Cancel
      </button>

      <div
        style={{
          width: 130,
          height: 130,
          borderRadius: '50%',
          position: 'relative',
          display: 'grid',
          placeItems: 'center',
          marginBottom: 36,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `2px solid ${V3.borderHi}`,
            opacity: 0.5,
            animation: 'v3Pulse 2s ease-in-out infinite',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 8,
            borderRadius: '50%',
            border: '2px solid transparent',
            borderTopColor: V3.ink,
            animation: 'v3Spin 1.4s linear infinite',
          }}
        />
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: V3.ink,
            opacity: 0.92,
          }}
        />
      </div>

      <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: V3.inkLight, fontWeight: 600, marginBottom: 6 }}>
        Step {effectivePhase + 1} of 4
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
        {PHASES[effectivePhase]}…
      </div>
      <div style={{ marginTop: 8, fontSize: 13, color: V3.inkLight }}>
        {foundItems.length > 0
          ? `${foundItems.length} item${foundItems.length === 1 ? '' : 's'} captured`
          : 'analyzing image'}
      </div>

      <div
        style={{
          marginTop: 28,
          width: '100%',
          maxWidth: 340,
          height: 3,
          background: V3.border,
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: V3.ink,
            transition: 'width 0.36s ease',
          }}
        />
      </div>
    </div>
  );
}
