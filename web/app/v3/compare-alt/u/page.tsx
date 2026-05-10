'use client';

import { useRouter } from 'next/navigation';
import CompareAltU from '@/components/aftercart-v3/alt/CompareAltU';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltUPage() {
  const router = useRouter();
  return (
    <CompareAltU
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
