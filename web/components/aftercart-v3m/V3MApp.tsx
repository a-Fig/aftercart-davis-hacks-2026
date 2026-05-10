'use client';

import { useState, useRef, useCallback } from 'react';
import V3MHome from './V3MHome';
import V3Scan from '@/components/aftercart-v3/V3Scan';   // mobile-OK already
import V3Review from '@/components/aftercart-v3/V3ReviewE';
import V3MCompare from './V3MCompare';
import { V3 } from '@/components/aftercart-v3/theme';
import type { MatchResponse, CompareResponse, Correction } from '@/lib/api/compare';
import { compareReceipt } from '@/lib/api/compare';

type Screen = 'home' | 'scanning' | 'review' | 'compare';

export default function V3MApp() {
  const [screen, setScreen] = useState<Screen>('home');
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResponse | null>(null);
  const [compareResp, setCompareResp] = useState<CompareResponse | null>(null);
  const [comparing, setComparing] = useState(false);

  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      setScanFile(file);
      setScreen('scanning');
    }
  };

  const handleScanComplete = useCallback((result: MatchResponse) => {
    setMatchResult(result);
    setScanFile(null);
    setScreen('review');
  }, []);

  const handleReviewConfirm = useCallback(async (corrections: Correction[]) => {
    if (!matchResult) return;
    setComparing(true);

    try {
      const resp = await compareReceipt(matchResult, corrections);
      setCompareResp(resp);
      setScreen('compare');
    } catch (err) {
      console.error('Compare failed:', err);
      throw err;
    } finally {
      setComparing(false);
    }
  }, [matchResult]);

  const handleReviewCancel = useCallback(() => {
    setMatchResult(null);
    setScanFile(null);
    setScreen('home');
  }, []);

  const handleScanCancel = useCallback(() => {
    setScanFile(null);
    setScreen('home');
  }, []);

  const handleCompareBack = useCallback(() => {
    setScreen('home');
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: V3.page,
        color: V3.ink,
        fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif',
      }}
    >
      {/* The phone-frame container — caps width at typical phone, centers on
          larger viewports so the demo reads as a mobile screen even on
          desktop. */}
      <div className="v3m-shell">
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFilePicked}
          style={{ display: 'none' }}
        />
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          onChange={onFilePicked}
          style={{ display: 'none' }}
        />

        {screen === 'home' && (
          <V3MHome
            hasReceipt={compareResp !== null}
            comparing={comparing}
            onCameraClick={() => cameraRef.current?.click()}
            onUploadClick={() => uploadRef.current?.click()}
            onViewLastScan={() => setScreen('compare')}
          />
        )}

        {screen === 'scanning' && (
          <V3Scan
            file={scanFile}
            comparing={comparing}
            onDone={handleScanComplete}
            onCancel={handleScanCancel}
          />
        )}

        {screen === 'review' && matchResult && (
          <V3Review
            matchResult={matchResult}
            comparing={comparing}
            onConfirm={handleReviewConfirm}
            onCancel={handleReviewCancel}
          />
        )}

        {screen === 'compare' && compareResp && matchResult && (
          <V3MCompare
            matchResult={matchResult}
            compareResp={compareResp}
            onBack={handleCompareBack}
            onRescan={() => cameraRef.current?.click()}
          />
        )}
      </div>

      <style jsx global>{`
        .v3m-shell {
          max-width: 430px;
          margin: 0 auto;
          min-height: 100vh;
          background: ${V3.page};
          /* Phone-frame look on larger displays so the mobile design is
             obvious during demo. Hidden on actual narrow viewports. */
          @media (min-width: 768px) {
            box-shadow: 0 0 0 1px ${V3.border}, 0 30px 80px rgba(0,0,0,0.55);
            border-left: 1px solid ${V3.border};
            border-right: 1px solid ${V3.border};
          }
        }
        /* Slim, faint scrollbar on the chain-pill row so desktop users see
           there's more to scroll. Mobile users discover it via the right-edge
           fade + the snap-to-start scroll behavior. */
        .v3m-chain-scroll::-webkit-scrollbar {
          height: 3px;
        }
        .v3m-chain-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .v3m-chain-scroll::-webkit-scrollbar-thumb {
          background: ${V3.borderHi};
          border-radius: 3px;
        }
        .v3-num {
          font-variant-numeric: tabular-nums;
          font-feature-settings: 'tnum';
          letter-spacing: -0.02em;
        }
        .v3-mono {
          font-family: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
          font-variant-numeric: tabular-nums;
          font-feature-settings: 'tnum';
        }
        @keyframes v3FadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes v3Pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
        @keyframes v3Spin { to { transform: rotate(360deg); } }
        ::selection { background: ${V3.saveInk}33; }
      `}</style>
    </div>
  );
}
