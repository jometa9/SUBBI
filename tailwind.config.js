/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        pr: {
          bg: '#232323',
          panel: '#2d2d2d',
          input: '#1a1a1a',
          border: '#3d3d3d',
          borderSoft: '#2a2a2a',
          text: '#d4d4d4',
          muted: '#8a8a8a',
          heading: '#bdbdbd',
          accent: '#9999ff',
          accentHover: '#b3b3ff',
          accentDeep: '#5b58e8',
          danger: '#ff6b6b',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
