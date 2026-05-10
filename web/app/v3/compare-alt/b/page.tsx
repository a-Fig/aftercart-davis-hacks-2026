'use client';

import { useRouter } from 'next/navigation';
import CompareAltB from '@/components/aftercart-v3/alt/CompareAltB';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltBPage() {
  const router = useRouter();
  return (
    <CompareAltB
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
