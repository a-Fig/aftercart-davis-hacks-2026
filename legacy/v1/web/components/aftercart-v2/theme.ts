// Dark fintech palette — deliberately contrasted with the v1 pastel forest theme.
// Same data shapes, different visual language.

export const V2 = {
  // Background tiers
  bg:        '#0a0b0d',
  surface:   '#15171c',
  surfaceAlt:'#1d2027',
  surfaceHi: '#252932',
  border:    'rgba(255,255,255,0.08)',
  borderHi:  'rgba(255,255,255,0.16)',

  // Ink (text on dark)
  ink:       '#f5f6f8',
  inkMid:    '#b9bdc7',
  inkLight:  '#838995',
  inkFaint:  '#5a6068',

  // Accents
  lime:      '#bef264',     // primary CTA + savings
  limeDim:   '#7c9c34',
  limeBg:    'rgba(190,242,100,0.12)',
  limeRing:  'rgba(190,242,100,0.35)',

  red:       '#ff6b6b',     // overpaid (when shown)
  redBg:     'rgba(255,107,107,0.12)',

  amber:     '#fbbf24',
  amberBg:   'rgba(251,191,36,0.14)',

  blue:      '#7dd3fc',
  blueBg:    'rgba(125,211,252,0.10)',

  // Freshness dots — readable on dark
  freshGreen:  '#4ade80',
  freshYellow: '#facc15',
  freshRed:    '#f87171',
};

export const fmt = (n: number) => `$${n.toFixed(2)}`;

// Big number formatter — keeps decimals tabular, optional sign.
export const fmtBig = (n: number, sign = false) => {
  const s = sign ? (n >= 0 ? '+' : '−') : '';
  return `${s}$${Math.abs(n).toFixed(2)}`;
};
