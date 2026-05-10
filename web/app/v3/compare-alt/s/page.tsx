'use client';

import { useRouter } from 'next/navigation';
import CompareAltS from '@/components/aftercart-v3/alt/CompareAltS';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltSPage() {
  const router = useRouter();
  return (
    <CompareAltS
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
