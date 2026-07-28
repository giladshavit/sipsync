// Raw design tokens for use in Reanimated worklets and imperative code
// (NativeWind classes can't be read at runtime — use these instead)

export const colors = {
  ink:     '#0A0A0F',
  surface: '#131320',
  rim:     '#252538',
  chalk:   '#F0F0E8',
  fog:     '#64748B',
  amber:   '#F59E0B',
  amberGlow: '#FCD34D',
  go:      '#16A34A',
  stop:    '#DC2626',
  tapped:  '#2563EB',
  orange:  '#F97316',
  electric: '#00D4FF',
  safe:    '#334155',
  silver:  '#B8C4D0',
  bronze:  '#C08552',
  // Light "front door" palette (home / podium / lobby)
  cream:     '#FFF8E1',
  parchment: '#FFFDF7',
  sand:      '#E4D9BE',
  dune:      '#A8977A',
} as const;

export type Color = keyof typeof colors;

// Shared text treatments — spread into a Text's style alongside color/size.
// Both are plain system sans (no fontFamily override): Courier New was
// showing up all over the app as a de facto default for small tracked caps
// text, and it reads too thin at these sizes. `title` is for standalone
// headings/eyebrows (a screen's own name, a section header); `label` is for
// smaller supporting text — stat readouts, kickers, inline data — that
// shouldn't compete with an actual title for weight.
//
// Do not reach for `fontFamily: 'Courier New'` for new UI text — use one of
// these two instead (see CLAUDE.md's Typography section).
export const typography = {
  title: {
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  label: {
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
} as const;
