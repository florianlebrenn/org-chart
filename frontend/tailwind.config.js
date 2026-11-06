/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: '#ffffff',
        ink: '#0f172a',
        muted: '#64748b',
        border: '#e2e8f0',
        ring: '#cbd5e1',
      },
    },
  },
  plugins: [],
}