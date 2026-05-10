'use client';

import { useState, useRef, useCallback } from 'react';
import V3Home from './V3Home';
import V3Scan from './V3Scan';
import V3Review from './V3ReviewE';
import V3Compare from './alt/CompareAltS';
import { V3 } from './theme';
import type { MatchResponse, CompareResponse, Correction } from '@/lib/api/compare';
import { compareReceipt } from '@/lib/api/compare';

type Screen = 'home' | 'scanning' | 'review' | 'compare';

export default function V3App() {
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
        <V3Home
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
        <V3Compare
          matchResult={matchResult}
          compareResp={compareResp}
          onBack={handleCompareBack}
          onRescan={() => cameraRef.current?.click()}
        />
      )}

      <style jsx global>{`
        .v3-num {
          font-variant-numeric: tabular-nums;
          font-feature-settings: 'tnum';
        }
        .v3-mono {
          font-family: 'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', monospace;
          font-variant-numeric: tabular-nums;
          font-feature-settings: 'tnum';
        }
        @keyframes v3FadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes v3Pulse { 0%,100% { opacity: 0.45; } 50% { opacity: 1; } }
        @keyframes v3Spin { to { transform: rotate(360deg); } }
        ::selection { background: ${V3.saveInk}33; }
      `}</style>
    </div>
  );
}
