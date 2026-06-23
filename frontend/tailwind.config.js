/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // SipSync design tokens
        ink:     '#0A0A0F', // near-black background, slight blue shift
        surface: '#131320', // card / panel
        rim:     '#252538', // subtle borders / dividers
        chalk:   '#F0F0E8', // primary text — warm white
        fog:     '#64748B', // secondary / muted text
        amber: {
          DEFAULT: '#F59E0B', // primary action — beer/whiskey amber
          glow:    '#FCD34D', // hover / active
          dim:     '#92400E', // pressed / disabled tint
        },
        go:   '#16A34A', // GREEN game state / WIN
        stop: '#DC2626', // RED  game state / LOSE
        safe: '#334155', // SAFE outcome
      },
      fontFamily: {
        mono: ['Courier New', 'monospace'], // room codes
      },
      letterSpacing: {
        tightest: '-0.05em',
        widest:   '0.2em',
      },
    },
  },
  plugins: [],
};
