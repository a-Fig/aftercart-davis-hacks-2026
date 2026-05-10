'use client';

import { useState, useRef, useCallback } from 'react';
import BottomNav from './BottomNav';
import HomeScreen from './HomeScreen';
import ScanningScreen from './ScanningScreen';
import ReviewScreen from './ReviewScreen';
import ResultsScreen from './ResultsScreen';
import SavedScreen from './SavedScreen';
import ItemDetailModal from './ItemDetailModal';
import { THEMES, ReceiptItem, Receipt, RECEIPT } from './data';
import type { MatchResponse, Correction } from '@/lib/api/compare';
import { compareReceipt } from '@/lib/api/compare';
import { toReceipt } from '@/lib/api/adapter';

// Three-stage flow:
//   home → (file picked) → scanning (POSTs /api/match) →
//   review (user confirms picks, POSTs /api/compare) → results
//
// 'review' was added in v1.2 of the product spec — the user sees and confirms
// the per-item match before any price comparison appears, so the headline
// number on results is a number they personally vouch for.
type Screen = 'home' | 'scanning' | 'review' | 'results';

export default function AfterCartApp() {
  const t = THEMES.forest;
  const [screen, setScreen] = useState<Screen>('home');
  const [tab, setTab] = useState('home');
  const [selectedItem, setSelectedItem] = useState<ReceiptItem | null>(null);
  const [savedItems, setSavedItems] = useState<Set<string>>(new Set());

  // The receipt currently being viewed. null until the user runs a real scan;
  // until then the home screen suppresses the "Last scan" card and every
  // screen below this point falls back to the mock RECEIPT so the demo never
  // looks empty.
  const [currentReceipt, setCurrentReceipt] = useState<Receipt | null>(null);
  const [scanFile, setScanFile] = useState<File | null>(null);

  // The /api/match payload — held while the user is on the review screen so
  // ReviewScreen can render candidates and we can POST the parsed receipt back
  // to /api/compare verbatim (no re-OCR) when the user confirms.
  const [matchResult, setMatchResult] = useState<MatchResponse | null>(null);

  // Set true while the review→results call is in flight — ReviewScreen uses
  // this to disable the confirm button so a double-tap doesn't double-submit.
  const [comparing, setComparing] = useState(false);

  const activeReceipt = currentReceipt ?? RECEIPT;

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

  const toggleSave = (id: string) =>
    setSavedItems(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const handleSetTab = (newTab: string) => {
    setTab(newTab);
    setScreen('home');
  };

  // Stable callbacks. ScanningScreen's effect depends on file identity; if
  // these were inline arrows, every parent re-render would create new function
  // refs, ScanningScreen's effect cleanup would abort the in-flight request,
  // and the scan would lock at "Reading receipt…". useCallback gives them
  // stable identity. (We had this exact freeze before.)
  const handleScanComplete = useCallback((result: MatchResponse) => {
    setMatchResult(result);
    setScanFile(null);
    setScreen('review');
  }, []);

  const handleScanCancel = useCallback(() => {
    setScanFile(null);
    setScreen('home');
  }, []);

  // ReviewScreen calls this when the user taps "Looks good — show prices".
  // We POST corrections to /api/compare, adapt the result, and slide into
  // ResultsScreen. On error we leave the user on the review screen with a
  // toast so they can retry without re-uploading.
  const handleReviewConfirm = useCallback(async (corrections: Correction[]) => {
    if (!matchResult) return;
    setComparing(true);
    try {
      const compareResp = await compareReceipt(matchResult, corrections);
      const adapted = toReceipt(compareResp);
      setCurrentReceipt(adapted);
      setScreen('results');
      // Don't clear matchResult yet — the user might back out of results.
      // Cleared on the next scan or when they go home from results.
    } catch (err) {
      console.error('Compare failed:', err);
      // TODO: surface an inline error in ReviewScreen rather than a console log.
      // For the hackathon demo the happy path matters more than retry UX.
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
    setTab('home');
  }, []);

  const mainTab = tab === 'saved' ? 'saved' : 'home';

  return (
    <div className="app-shell" style={{ background: t.bg }}>
      {/* Hidden inputs — programmatically clicked by HomeScreen and BottomNav. */}
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

      {/* Scrollable screen area */}
      <div className="screen-scroll" style={{ bottom: screen !== 'scanning' ? 66 : 0 }}>
        {screen === 'home' && mainTab === 'home' && (
          <HomeScreen
            receipt={activeReceipt}
            hasReceipt={currentReceipt !== null}
            onCameraClick={() => cameraRef.current?.click()}
            onUploadClick={() => uploadRef.current?.click()}
            onViewLastScan={() => setScreen('results')}
          />
        )}
        {screen === 'home' && mainTab === 'saved' && (
          <SavedScreen
            receipt={activeReceipt}
            savedItems={savedItems}
            onItemClick={setSelectedItem}
          />
        )}
        {screen === 'scanning' && (
          <ScanningScreen
            file={scanFile}
            onDone={handleScanComplete}
            onCancel={handleScanCancel}
          />
        )}
        {screen === 'review' && matchResult && (
          <ReviewScreen
            matchResult={matchResult}
            comparing={comparing}
            onConfirm={handleReviewConfirm}
            onCancel={handleReviewCancel}
          />
        )}
        {screen === 'results' && (
          <ResultsScreen
            receipt={activeReceipt}
            savedItems={savedItems}
            onItemClick={setSelectedItem}
            onBack={handleResultsBack}
          />
        )}
      </div>

      {/* Bottom nav — hidden during scan + review (focus mode). */}
      {screen !== 'scanning' && screen !== 'review' && (
        <BottomNav
          t={t}
          tab={tab}
          setTab={handleSetTab}
          onScan={() => cameraRef.current?.click()}
        />
      )}

      {/* Item detail modal */}
      {selectedItem && (
        <ItemDetailModal
          item={selectedItem}
          savedItems={savedItems}
          onToggleSave={toggleSave}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
}
