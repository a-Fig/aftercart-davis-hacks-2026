'use client';

import { useRouter } from 'next/navigation';
import V3Compare from '@/components/aftercart-v3/alt/CompareAltS';
import { V3 } from '@/components/aftercart-v3/theme';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltCurrentPage() {
  const router = useRouter();
  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif' }}>
      <V3Compare
        matchResult={matchResult}
        compareResp={compareResp}
        onBack={() => router.push('/v3/compare-alt')}
        onRescan={() => router.push('/v3/compare-alt')}
      />
    </div>
  );
}
