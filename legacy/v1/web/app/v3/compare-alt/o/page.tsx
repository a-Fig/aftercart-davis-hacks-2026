'use client';

import { useRouter } from 'next/navigation';
import CompareAltO from '@/components/aftercart-v3/alt/CompareAltO';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltOPage() {
  const router = useRouter();
  return (
    <CompareAltO
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
