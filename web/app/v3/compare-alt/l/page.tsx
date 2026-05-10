'use client';

import { useRouter } from 'next/navigation';
import CompareAltL from '@/components/aftercart-v3/alt/CompareAltL';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltLPage() {
  const router = useRouter();
  return (
    <CompareAltL
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
