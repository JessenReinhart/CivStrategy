/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'dust-white': '#F5F1E8',
        parchment: '#E6DCC4',
        limestone: '#C9BFA6',
        sandstone: '#8C7E66',
        obsidian: '#2E2824',
        'gold-leaf': '#D4AF37',
        'amber-glow': '#FFDF8F',
        terracotta: '#8B5A2B',
      },
      fontFamily: {
        display: ['Cinzel', 'serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};