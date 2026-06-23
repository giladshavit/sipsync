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
  safe:    '#334155',
} as const;

export type Color = keyof typeof colors;
