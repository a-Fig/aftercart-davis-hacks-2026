'use client';

import { useRouter } from 'next/navigation';
import CompareAltH from '@/components/aftercart-v3/alt/CompareAltH';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltHPage() {
  const router = useRouter();
  return (
    <CompareAltH
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
