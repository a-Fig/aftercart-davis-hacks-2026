// Paper-receipt aesthetic on a clean modern chrome.
// The receipts feel like printed receipts; the page around them feels app-modern.

export const V3 = {
  // Page chrome
  page:        '#1a1c1f',     // dark workbench so paper receipts pop
  pageAlt:     '#23262b',
  chrome:      '#101216',
  ink:         '#f6f5f1',
  inkMid:      '#bfc1c4',
  inkLight:    '#878a8f',
  inkFaint:    '#5a5d62',
  border:      'rgba(255,255,255,0.08)',
  borderHi:    'rgba(255,255,255,0.18)',

  // Paper (the receipts themselves)
  paper:       '#fbf7ee',     // warm cream
  paperShade:  '#f1ebdc',     // slight band stripe
  paperLine:   'rgba(40,30,15,0.18)',
  paperInk:    '#1c1a14',
  paperMid:    '#4a463b',
  paperMute:   '#857d6a',
  paperFaint:  '#b3ac99',

  // Accents
  // Savings — green. Reads as "good outcome" universally; red for savings was
  // ambiguous (could mean "money lost") and clashed with the overage color.
  saveInk:     '#1f7a3a',
  savePaper:   '#e8f4ec',
  saveOutline: '#1f7a3aaa',

  // Overage — red. Used when the alt store would have cost MORE than the user
  // actually paid. Symmetric to savings: green = better here, red = worse.
  overInk:     '#c8341d',
  overPaper:   '#fcebe6',
  overOutline: '#c8341daa',

  edited:      '#9c5500',     // amber — user-touched line
  editedBg:    '#fff4dd',

  none:        '#a4a09a',     // greys for excluded lines
  noneBg:      '#efeae0',
};

export const fmt = (n: number) => `$${n.toFixed(2)}`;
// Formats |n| with no leading sign — direction is conveyed by the surrounding
// label/color. Avoids "Save −$3" which reads like the user spent $3 more.
export const fmtAbs = (n: number) => `$${Math.abs(n).toFixed(2)}`;
