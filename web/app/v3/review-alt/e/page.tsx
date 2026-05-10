'use client';

import { useRouter } from 'next/navigation';
import ReviewAltE from '@/components/aftercart-v3/V3ReviewE';
import { mockResult } from '@/app/v3/review-test/mock-data';

export default function ReviewAltEPage() {
  const router = useRouter();
  return (
    <ReviewAltE
      matchResult={mockResult}
      comparing={false}
      onConfirm={async () => {}}
      onCancel={() => router.push('/v3/review-alt')}
    />
  );
}
