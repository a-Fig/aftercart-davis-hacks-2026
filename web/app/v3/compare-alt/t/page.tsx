'use client';

import { useRouter } from 'next/navigation';
import CompareAltT from '@/components/aftercart-v3/alt/CompareAltT';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltTPage() {
  const router = useRouter();
  return (
    <CompareAltT
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
