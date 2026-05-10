'use client';

import { useRouter } from 'next/navigation';
import CompareAltC from '@/components/aftercart-v3/alt/CompareAltC';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltCPage() {
  const router = useRouter();
  return (
    <CompareAltC
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
