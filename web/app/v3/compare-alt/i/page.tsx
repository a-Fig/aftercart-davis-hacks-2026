'use client';

import { useRouter } from 'next/navigation';
import CompareAltI from '@/components/aftercart-v3/alt/CompareAltI';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltIPage() {
  const router = useRouter();
  return (
    <CompareAltI
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
