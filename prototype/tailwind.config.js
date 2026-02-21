/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Claude-style warm neutrals
        'claude': {
          'cream': '#FAF8F5',       // page background
          'surface': '#F5F1EB',    // cards, sidebar
          'border': '#E8E4DD',     // borders
          'muted': '#D4CFC7',      // subtle dividers
          'stone': {
            750: '#44403C',        // primary text
            650: '#57534E',        // secondary text
            550: '#78716C',        // tertiary / placeholder
            450: '#A8A29E',        // disabled
          },
          'ink': '#1C1917',        // headings, strong text
          'amber': {
            DEFAULT: '#D97706',   // primary accent
            light: '#FBBF24',     // hover
            dark: '#B45309',      // active
            soft: '#FEF3C7',      // badge bg
          },
          'orange': '#EA580C',    // secondary accent
          'green': {
            soft: '#D1FAE5',     // success bg
            DEFAULT: '#059669',   // success
          },
          'red': {
            soft: '#FEE2E2',     // error bg
            DEFAULT: '#DC2626',   // error
          },
        },
        // legacy aliases for gradual migration
        'alice-blue': '#00D9FF',
        'alice-purple': '#B030FF',
      },
      fontFamily: {
        sans: [
          'Soehne',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      boxShadow: {
        'claude': '0 1px 3px 0 rgb(28 25 23 / 0.08), 0 1px 2px -1px rgb(28 25 23 / 0.08)',
        'claude-md': '0 4px 6px -1px rgb(28 25 23 / 0.06), 0 2px 4px -2px rgb(28 25 23 / 0.06)',
        'claude-lg': '0 10px 15px -3px rgb(28 25 23 / 0.06), 0 4px 6px -4px rgb(28 25 23 / 0.06)',
      },
      borderRadius: {
        'claude': '0.75rem',   // 12px
        'claude-lg': '1rem',   // 16px
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
