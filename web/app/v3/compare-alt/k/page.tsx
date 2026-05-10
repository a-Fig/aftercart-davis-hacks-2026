'use client';

import { useRouter } from 'next/navigation';
import CompareAltK from '@/components/aftercart-v3/alt/CompareAltK';
import { compareResp, matchResult } from '../mock-data';

export default function CompareAltKPage() {
  const router = useRouter();
  return (
    <CompareAltK
      matchResult={matchResult}
      compareResp={compareResp}
      onBack={() => router.push('/v3/compare-alt')}
    />
  );
}
