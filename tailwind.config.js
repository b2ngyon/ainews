/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  darkMode: 'class',
  theme: {
    screens: {
      sm: '480px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1440px',
    },
    extend: {
      colors: {
        surface: {
          950: '#0A0E14',
          900: '#0F1520',
          800: '#151C2C',
          700: '#1E2739',
          600: '#2A3547',
        },
        accent: {
          DEFAULT: '#2DD4BF',
          600: '#0D9488',
        },
        severity: {
          critical: {
            DEFAULT: '#DC2626',
            bg: '#450A0A',
            text: '#FCA5A5',
            border: '#B91C1C',
          },
          high: {
            DEFAULT: '#EA580C',
            bg: '#431407',
            text: '#FDBA74',
            border: '#C2410C',
          },
          medium: {
            DEFAULT: '#CA8A04',
            bg: '#422006',
            text: '#FDE047',
            border: '#A16207',
          },
          low: {
            DEFAULT: '#16A34A',
            bg: '#052e16',
            text: '#86EFAC',
            border: '#15803D',
          },
        },
        danger: {
          bg: '#450A0A',
          border: '#B91C1C',
          text: '#FCA5A5',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '0.75rem',
      },
    },
  },
  plugins: [],
}
