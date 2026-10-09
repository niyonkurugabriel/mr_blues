/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#09111f',
        panel: '#101b2d',
        accent: '#38bdf8',
        gain: '#34d399',
        loss: '#f87171'
      }
    }
  },
  plugins: []
};
