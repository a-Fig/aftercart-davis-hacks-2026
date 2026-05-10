'use client';

import { V3 } from './theme';

type Props = {
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
};

const CONF_COLORS: Record<string, string> = {
  high: V3.saveInk,
  medium: V3.edited,
  low: V3.overInk,
};

export default function LlmReasoningLine({ reasoning, confidence }: Props) {
  return (
    <div style={{ fontSize: 11, color: V3.paperMid, lineHeight: 1.5, marginTop: 4 }}>
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: CONF_COLORS[confidence] || V3.paperMute,
          marginRight: 5,
          verticalAlign: 'middle',
        }}
        title={`${confidence} confidence`}
      />
      {reasoning}
    </div>
  );
}
