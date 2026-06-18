/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Merriweather', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        stone: {
          50: '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
        }
      },
      keyframes: {
        'tile-in': {
          '0%': { opacity: '0', transform: 'translateY(10px) scale(0.9)' },
          '60%': { opacity: '1' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(5px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'soft-pulse': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(0.78)' },
        },
        'menu-in': {
          '0%': { opacity: '0', transform: 'scale(0.96) translateY(4px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'value-flash': {
          '0%': { transform: 'scale(1)', filter: 'brightness(1)' },
          '30%': { transform: 'scale(1.18)', filter: 'brightness(1.6)' },
          '100%': { transform: 'scale(1)', filter: 'brightness(1)' },
        },
      },
      animation: {
        'tile-in': 'tile-in 0.34s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.3s ease-out both',
        'soft-pulse': 'soft-pulse 2.2s ease-in-out infinite',
        'menu-in': 'menu-in 0.16s cubic-bezier(0.22,1,0.36,1) both',
        'value-flash': 'value-flash 0.5s cubic-bezier(0.22,1,0.36,1)',
      },
    },
  },
  plugins: [],
}
