'use client';

import { useState, useRef, useCallback } from 'react';
import V2Home from './V2Home';
import V2Scan from './V2Scan';
import V2Review from './V2Review';
import V2Results from './V2Results';
import V2Modal from './V2Modal';
import { V2 } from './theme';
import type { ReceiptItem, Receipt } from '@/components/aftercart/data';
import { RECEIPT } from '@/components/aftercart/data';
import type { MatchResponse, Correction } from '@/lib/api/compare';
import { compareReceipt } from '@/lib/api/compare';
import { toReceipt } from '@/lib/api/adapter';

// Same state machine as v1's AfterCartApp; re-presented in a different visual
// language. Reuses the existing API client + adapter so inputs/outputs match.
type Screen = 'home' | 'scanning' | 'review' | 'results';

export default function V2App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResponse | null>(null);
  const [currentReceipt, setCurrentReceipt] = useState<Receipt | null>(null);
  const [comparing, setComparing] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ReceiptItem | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const activeReceipt = currentReceipt ?? RECEIPT;

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      setScanFile(file);
      setScreen('scanning');
    }
  };

  // Stable callbacks — same pattern as AfterCartApp; ScanningScreen depends on
  // file identity only, not on parent re-renders, or its in-flight fetch dies.
  const handleScanComplete = useCallback((result: MatchResponse) => {
    setMatchResult(result);
    setScanFile(null);
    setScreen('review');
  }, []);

  const handleScanCancel = useCallback(() => {
    setScanFile(null);
    setScreen('home');
  }, []);

  const handleReviewConfirm = useCallback(async (corrections: Correction[]) => {
    if (!matchResult) return;
    setComparing(true);
    try {
      const compareResp = await compareReceipt(matchResult, corrections);
      setCurrentReceipt(toReceipt(compareResp));
      setScreen('results');
    } catch (err) {
      console.error('Compare failed:', err);
      setComparing(false);
      throw err;
    }
    setComparing(false);
  }, [matchResult]);

  const handleReviewCancel = useCallback(() => {
    setMatchResult(null);
    setScreen('home');
  }, []);

  const handleResultsBack = useCallback(() => {
    setMatchResult(null);
    setScreen('home');
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: V2.bg,
        color: V2.ink,
        fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif',
      }}
    >
      <div className="v2-shell">
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
          <V2Home
            receipt={currentReceipt}
            onCameraClick={() => cameraRef.current?.click()}
            onUploadClick={() => uploadRef.current?.click()}
            onViewLastScan={() => setScreen('results')}
          />
        )}

        {screen === 'scanning' && (
          <V2Scan
            file={scanFile}
            onDone={handleScanComplete}
            onCancel={handleScanCancel}
          />
        )}

        {screen === 'review' && matchResult && (
          <V2Review
            matchResult={matchResult}
            comparing={comparing}
            onConfirm={handleReviewConfirm}
            onCancel={handleReviewCancel}
          />
        )}

        {screen === 'results' && (
          <V2Results
            receipt={activeReceipt}
            onBack={handleResultsBack}
            onItemClick={setSelectedItem}
            onScanAgain={() => cameraRef.current?.click()}
          />
        )}

        {selectedItem && (
          <V2Modal
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
          />
        )}
      </div>

      <style jsx global>{`
        .v2-shell {
          max-width: 480px;
          margin: 0 auto;
          min-height: 100vh;
          position: relative;
          background: ${V2.bg};
        }
        .v2-num {
          font-variant-numeric: tabular-nums;
          font-feature-settings: 'tnum';
          letter-spacing: -0.02em;
        }
        @keyframes v2FadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes v2Pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        @keyframes v2Sweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes v2Spin { to { transform: rotate(360deg); } }
        ::selection { background: ${V2.lime}; color: ${V2.bg}; }
      `}</style>
    </div>
  );
}
