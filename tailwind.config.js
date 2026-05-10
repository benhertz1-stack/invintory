/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        wine: {
          50: '#fdf2f4',
          100: '#fce7eb',
          200: '#f9d0d8',
          300: '#f4aab8',
          400: '#ec7a8f',
          500: '#e04d69',
          600: '#cc2d50',
          700: '#ab1f40',
          800: '#8f1c3a',
          900: '#7b1b36',
          950: '#430a1a',
        },
      },
    },
  },
  plugins: [],
};
