/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gray: {
          50: 'rgb(var(--gray-50) / <alpha-value>)',
          100: 'rgb(var(--gray-100) / <alpha-value>)',
          200: 'rgb(var(--gray-200) / <alpha-value>)',
          300: 'rgb(var(--gray-300) / <alpha-value>)',
          400: 'rgb(var(--gray-400) / <alpha-value>)',
          500: 'rgb(var(--gray-500) / <alpha-value>)',
          600: 'rgb(var(--gray-600) / <alpha-value>)',
          700: 'rgb(var(--gray-700) / <alpha-value>)',
          800: 'rgb(var(--gray-800) / <alpha-value>)',
          900: 'rgb(var(--gray-900) / <alpha-value>)',
        },
        slate: {
          50: 'rgb(var(--slate-50) / <alpha-value>)',
          100: 'rgb(var(--slate-100) / <alpha-value>)',
          200: 'rgb(var(--slate-200) / <alpha-value>)',
          300: 'rgb(var(--slate-300) / <alpha-value>)',
          400: 'rgb(var(--slate-400) / <alpha-value>)',
          500: 'rgb(var(--slate-500) / <alpha-value>)',
          600: 'rgb(var(--slate-600) / <alpha-value>)',
          700: 'rgb(var(--slate-700) / <alpha-value>)',
          800: 'rgb(var(--slate-800) / <alpha-value>)',
          900: 'rgb(var(--slate-900) / <alpha-value>)',
        },
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
      },
      boxShadow: {
        'soft':  '0 2px 8px 0 rgba(0,0,0,0.06)',
        'card':  '0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.06)',
        'float': '0 8px 24px 0 rgba(0,0,0,0.12)',
        'glow':  '0 0 0 3px rgba(99,102,241,0.15)',
      },
      borderRadius: {
        'xl':  '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-up':   'slideUp 0.25s ease-out',
        'pulse-soft': 'pulseSoft 2s infinite',
      },
      keyframes: {
        fadeIn:     { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp:    { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        pulseSoft:  { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.6 } },
      },
    },
  },
  plugins: [],
}
