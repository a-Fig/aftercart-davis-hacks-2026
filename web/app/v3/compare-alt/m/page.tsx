'use client';

import { useRouter } from 'next/navigation';
import CompareAltM from '@/components/aftercart-v3/alt/CompareAltM';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltMPage() {
  const router = useRouter();
  return (
    <CompareAltM
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
