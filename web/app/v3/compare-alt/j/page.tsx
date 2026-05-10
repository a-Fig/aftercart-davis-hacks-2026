'use client';

import { useRouter } from 'next/navigation';
import CompareAltJ from '@/components/aftercart-v3/alt/CompareAltJ';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltJPage() {
  const router = useRouter();
  return (
    <CompareAltJ
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
