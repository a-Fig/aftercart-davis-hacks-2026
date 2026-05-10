'use client';

import { useRouter } from 'next/navigation';
import CompareAltV from '@/components/aftercart-v3/alt/CompareAltV';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltVPage() {
  const router = useRouter();
  return (
    <CompareAltV
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
