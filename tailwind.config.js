/*
  LocalizaBus — tailwind.config.js
  Configuração do Tailwind CSS: arquivos analisados e tema base.
  Comentários feitos em linguagem simples para você conseguir mexer depois sem se perder.
*/

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        apple: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      letterSpacing: {
        apple: '-0.02em',
      },
      screens: {
        xs: '480px',
      },
    },
  },
  plugins: [],
};
