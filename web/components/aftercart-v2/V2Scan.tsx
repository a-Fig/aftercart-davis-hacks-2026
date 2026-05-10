'use client';

import { useState, useEffect, useRef } from 'react';
import { V2 } from './theme';
import { matchReceipt, type MatchResponse } from '@/lib/api/compare';

const PHASES = ['Reading receipt', 'Extracting items', 'Matching products'];

interface V2ScanProps {
  file: File | null;
  onDone: (result: MatchResponse) => void;
  onCancel: () => void;
}

export default function V2Scan({ file, onDone, onCancel }: V2ScanProps) {
  const [phase, setPhase] = useState(0);
  const [foundItems, setFoundItems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Latest-ref pattern — same gotcha as v1's ScanningScreen.
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
          await new Promise((r) => setTimeout(r, 95));
        }

        if (cancelled) return;
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

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 28px', background: V2.bg, color: V2.ink }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10, textAlign: 'center', letterSpacing: '-0.02em' }}>
          Couldn&apos;t read that receipt
        </div>
        <div style={{ fontSize: 14, color: V2.inkLight, marginBottom: 24, textAlign: 'center', lineHeight: 1.5, maxWidth: 320 }}>
          {error}
        </div>
        <button
          onClick={onCancel}
          style={{
            padding: '12px 24px',
            borderRadius: 12,
            border: `1px solid ${V2.borderHi}`,
            background: V2.surface,
            color: V2.ink,
            fontFamily: 'inherit',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Try a different photo
        </button>
      </div>
    );
  }

  const progress = Math.min(95, 8 + phase * 28 + foundItems.length * 4);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: V2.bg, padding: '28px 22px 40px', position: 'relative' }}>
      {/* Cancel — top-right */}
      <button
        onClick={onCancel}
        style={{
          position: 'absolute',
          top: 22,
          right: 22,
          background: 'transparent',
          color: V2.inkLight,
          border: `1px solid ${V2.border}`,
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

      {/* Big glowing dot — visual anchor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 360 }}>
        <div
          style={{
            width: 168,
            height: 168,
            borderRadius: '50%',
            position: 'relative',
            display: 'grid',
            placeItems: 'center',
            background: `radial-gradient(circle at center, ${V2.limeBg} 0%, transparent 70%)`,
          }}
        >
          {/* outer ring */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: `2px solid ${V2.lime}`,
              opacity: 0.45,
              animation: 'v2Pulse 2.2s ease-in-out infinite',
            }}
          />
          {/* spinning arc */}
          <div
            style={{
              position: 'absolute',
              inset: 12,
              borderRadius: '50%',
              border: `2px solid transparent`,
              borderTopColor: V2.lime,
              animation: 'v2Spin 1.4s linear infinite',
            }}
          />
          {/* inner dot */}
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: V2.lime,
              boxShadow: `0 0 24px ${V2.lime}`,
            }}
          />
        </div>

        {/* Phase text */}
        <div style={{ marginTop: 32, textAlign: 'center' }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: V2.inkLight,
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            Step {phase + 1} of 3
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {PHASES[phase]}<span style={{ color: V2.lime }}>…</span>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: V2.inkLight }}>
            {foundItems.length > 0
              ? `${foundItems.length} item${foundItems.length === 1 ? '' : 's'} captured`
              : 'analyzing image'}
          </div>
        </div>

        {/* Progress bar */}
        <div
          style={{
            marginTop: 28,
            width: '100%',
            maxWidth: 280,
            height: 4,
            background: V2.surfaceAlt,
            borderRadius: 4,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: V2.lime,
              borderRadius: 4,
              transition: 'width 0.36s ease',
              boxShadow: `0 0 12px ${V2.lime}`,
            }}
          />
        </div>
      </div>

      {/* Found-items list — pops in */}
      <div
        style={{
          maxWidth: 320,
          margin: '0 auto',
          width: '100%',
          minHeight: 88,
        }}
      >
        {foundItems.slice(-4).map((item, i, arr) => (
          <div
            key={`${item}-${arr.length - i}`}
            style={{
              padding: '8px 12px',
              fontSize: 12,
              color: V2.inkMid,
              background: V2.surface,
              border: `1px solid ${V2.border}`,
              borderRadius: 10,
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              animation: 'v2FadeUp 0.25s ease',
              opacity: 0.4 + ((i + 1) / arr.length) * 0.6,
            }}
          >
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: V2.lime, boxShadow: `0 0 6px ${V2.lime}` }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
