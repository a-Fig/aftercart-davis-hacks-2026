'use client';

import { useRouter } from 'next/navigation';
import ReviewAltC from '@/components/aftercart-v3/alt/ReviewAltC';
import { mockResult } from '@/app/v3/review-test/mock-data';

export default function ReviewAltCPage() {
  const router = useRouter();
  return (
    <ReviewAltC
      matchResult={mockResult}
      comparing={false}
      onConfirm={async () => {}}
      onCancel={() => router.push('/v3/review-alt')}
    />
  );
}
