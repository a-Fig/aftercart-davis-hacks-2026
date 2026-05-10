'use client';

import { useRouter } from 'next/navigation';
import CompareAltD from '@/components/aftercart-v3/alt/CompareAltD';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltDPage() {
  const router = useRouter();
  return (
    <CompareAltD
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
