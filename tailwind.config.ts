import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // STACKD TRADER brand palette
        bg: '#0A0A0A',
        ink: '#F5F0E8',
        accent: '#F5C400',
        // semantic
        success: '#1FCC79',
        danger: '#FF4D4F',
        warn: '#FF8A1F',
        muted: '#8A867F',
        panel: '#121212',
        line: '#1F1E1B',
      },
      fontFamily: {
        // wired up in app/layout.tsx via next/font
        syne: ['var(--font-syne)', 'sans-serif'],
        sans: ['var(--font-dm-sans)', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(245, 196, 0, 0.35), 0 8px 30px rgba(245, 196, 0, 0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
