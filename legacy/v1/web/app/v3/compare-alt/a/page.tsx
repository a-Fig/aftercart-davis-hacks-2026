'use client';

import { useRouter } from 'next/navigation';
import CompareAltA from '@/components/aftercart-v3/alt/CompareAltA';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltAPage() {
  const router = useRouter();
  return (
    <CompareAltA
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
