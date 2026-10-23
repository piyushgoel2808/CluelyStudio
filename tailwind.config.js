/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cluely: {
          dark: '#0d0d0f',
          topBar: '#767679',
          bottomBar: '#464649',
          accent: '#38bdf8',
        },
      },
      animation: {
        'equalizer-1': 'equalizer 0.8s ease-in-out infinite alternate',
        'equalizer-2': 'equalizer 1.1s ease-in-out infinite alternate 0.2s',
        'equalizer-3': 'equalizer 0.7s ease-in-out infinite alternate 0.4s',
        'equalizer-4': 'equalizer 1.2s ease-in-out infinite alternate 0.1s',
        'equalizer-5': 'equalizer 0.9s ease-in-out infinite alternate 0.3s',
      },
      keyframes: {
        equalizer: {
          '0%': { height: '3px' },
          '100%': { height: '14px' },
        },
      },
    },
  },
  plugins: [],
};
