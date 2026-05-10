'use client';

import V3ReviewA from '@/components/aftercart-v3/V3ReviewA';
import { mockResult } from '../review-test/mock-data';

export default function ReviewTestAPage() {
  return (
    <V3ReviewA
      matchResult={mockResult}
      comparing={false}
      onConfirm={async () => {}}
      onCancel={() => {}}
    />
  );
}
