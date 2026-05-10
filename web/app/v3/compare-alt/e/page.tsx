'use client';

import { useRouter } from 'next/navigation';
import CompareAltE from '@/components/aftercart-v3/alt/CompareAltE';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltEPage() {
  const router = useRouter();
  return (
    <CompareAltE
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
