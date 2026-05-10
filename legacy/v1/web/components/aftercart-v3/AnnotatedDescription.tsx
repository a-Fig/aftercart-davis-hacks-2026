'use client';

import { V3 } from './theme';

type Annotation = {
  field: string;
  original: string;
  interpreted: string;
  method: string;
};

type Props = {
  normalized: string;
  annotations: Annotation[];
};

const pill = (bg: string, fg: string, label: string, key: string) => (
  <span
    key={key}
    style={{
      fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 9999,
      background: bg, color: fg, marginLeft: 3, verticalAlign: 'middle',
      whiteSpace: 'nowrap',
    }}
  >
    {label}
  </span>
);

export default function AnnotatedDescription({ normalized, annotations }: Props) {
  // Build a lookup: interpreted word(s) → annotation, for abbreviation expansions
  const abbrMap = new Map<string, Annotation>();
  for (const a of annotations) {
    if (a.method === 'abbreviation_dict') {
      abbrMap.set(a.interpreted.toLowerCase(), a);
    }
  }

  // Render the normalized text with dotted underlines on expanded words
  const words = normalized.split(/(\s+)/);
  const rendered = words.map((seg, i) => {
    const a = abbrMap.get(seg.toLowerCase());
    if (a) {
      return (
        <span
          key={i}
          title={`${a.original} → ${a.interpreted}`}
          style={{
            textDecoration: 'underline',
            textDecorationStyle: 'dotted',
            textDecorationColor: V3.paperMid,
            textUnderlineOffset: 2,
            cursor: 'help',
          }}
        >
          {seg}
        </span>
      );
    }
    return <span key={i}>{seg}</span>;
  });

  // Collect trailing pills for non-abbreviation annotations
  const pills: React.ReactNode[] = [];
  for (const a of annotations) {
    if (a.method === 'brand_prefix')
      pills.push(pill(V3.editedBg, V3.edited, a.interpreted, `brand-${a.original}`));
    else if (a.method === 'size_regex')
      pills.push(pill(V3.savePaper, V3.saveInk, a.interpreted, `size-${a.original}`));
    else if (a.method === 'organic_flag')
      pills.push(pill('#e8f4ec', '#1f7a3a', 'organic', `org-${a.original}`));
  }

  return (
    <span style={{ fontSize: 13, lineHeight: 1.5, color: V3.paperInk }}>
      {rendered}
      {pills}
    </span>
  );
}
