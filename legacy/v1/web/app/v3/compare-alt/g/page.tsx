'use client';

import { useRouter } from 'next/navigation';
import CompareAltG from '@/components/aftercart-v3/alt/CompareAltG';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltGPage() {
  const router = useRouter();
  return (
    <CompareAltG
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
