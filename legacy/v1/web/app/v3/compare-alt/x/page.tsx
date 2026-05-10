'use client';

import { useRouter } from 'next/navigation';
import CompareAltX from '@/components/aftercart-v3/alt/CompareAltX';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltXPage() {
  const router = useRouter();
  return (
    <CompareAltX
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
