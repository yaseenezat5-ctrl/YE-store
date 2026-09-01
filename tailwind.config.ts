import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        dark: '#020817',
        panel: '#0f172a',
        accent: '#34d399',
        warm: '#fbbf24',
        info: '#60a5fa'
      }
    },
  },
  plugins: [],
};

export default config;
