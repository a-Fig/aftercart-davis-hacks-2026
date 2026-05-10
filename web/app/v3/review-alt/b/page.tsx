'use client';

import { useRouter } from 'next/navigation';
import ReviewAltB from '@/components/aftercart-v3/alt/ReviewAltB';
import { mockResult } from '@/app/v3/review-test/mock-data';

export default function ReviewAltBPage() {
  const router = useRouter();
  return (
    <ReviewAltB
      matchResult={mockResult}
      comparing={false}
      onConfirm={async () => {}}
      onCancel={() => router.push('/v3/review-alt')}
    />
  );
}
