'use client';

import V3Review from '@/components/aftercart-v3/V3ReviewA';
import { mockResult } from './mock-data';

export default function ReviewTestPage() {
  return (
    <V3Review
      matchResult={mockResult}
      comparing={false}
      onConfirm={async () => {}}
      onCancel={() => {}}
    />
  );
}
