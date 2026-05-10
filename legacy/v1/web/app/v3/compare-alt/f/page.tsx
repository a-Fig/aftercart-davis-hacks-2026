'use client';

import { useRouter } from 'next/navigation';
import CompareAltF from '@/components/aftercart-v3/alt/CompareAltF';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltFPage() {
  const router = useRouter();
  return (
    <CompareAltF
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
