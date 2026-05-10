'use client';

import { useRouter } from 'next/navigation';
import CompareAltW from '@/components/aftercart-v3/alt/CompareAltW';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltWPage() {
  const router = useRouter();
  return (
    <CompareAltW
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
