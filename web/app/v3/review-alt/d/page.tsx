'use client';

import { useRouter } from 'next/navigation';
import ReviewAltD from '@/components/aftercart-v3/alt/ReviewAltD';
import { mockResult } from '@/app/v3/review-test/mock-data';

export default function ReviewAltDPage() {
  const router = useRouter();
  return (
    <ReviewAltD
      matchResult={mockResult}
      comparing={false}
      onConfirm={async () => {}}
      onCancel={() => router.push('/v3/review-alt')}
    />
  );
}
