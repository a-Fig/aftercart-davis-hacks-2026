'use client';

import { useRouter } from 'next/navigation';
import CompareAltN from '@/components/aftercart-v3/alt/CompareAltN';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltNPage() {
  const router = useRouter();
  return (
    <CompareAltN
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
