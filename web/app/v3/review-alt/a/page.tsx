'use client';

import { useRouter } from 'next/navigation';
import ReviewAltA from '@/components/aftercart-v3/alt/ReviewAltA';
import { mockResult } from '@/app/v3/review-test/mock-data';

export default function ReviewAltAPage() {
  const router = useRouter();
  return (
    <ReviewAltA
      matchResult={mockResult}
      comparing={false}
      onConfirm={async () => {}}
      onCancel={() => router.push('/v3/review-alt')}
    />
  );
}
