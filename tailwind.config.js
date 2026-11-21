/** @type {import('tailwindcss').Config} */
/**
 * Every colour is a CSS variable so a theme swap is one attribute on <html>.
 * Values are space-separated RGB triplets, which is what lets Tailwind apply its
 * own alpha (`bg-ink-900/70`) on top of them. See src/styles/index.css for the
 * theme tables.
 */
const variable = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const SHADES = ['950', '900', '850', '800', '750', '700', '600', '500', '400', '300', '200', '100'];

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // The surface ramp, from the page background up to primary text. Themes
        // invert it, which is why a light skin needs no component changes.
        ink: Object.fromEntries(SHADES.map((shade) => [shade, variable(`ink-${shade}`)])),
        accent: {
          DEFAULT: variable('accent'),
          hover: variable('accent-hover'),
          ink: variable('accent-ink'),
          dim: 'rgb(var(--accent) / 0.14)',
        },
        // Conversation bubbles. `out` is the message you sent, `in` is the one
        // you received — the one distinction a chat has to make instantly.
        bubble: {
          out: variable('bubble-out'),
          in: variable('bubble-in'),
        },
        ok: variable('ok'),
        warn: variable('warn'),
        bad: variable('bad'),
        surface: variable('surface'),
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Consolas', 'monospace'],
      },
      borderRadius: {
        lg: '0.625rem',
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
        accent: '0 8px 28px -10px rgb(var(--accent) / 0.55)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        rise: { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'none' } },
        'splash-pop': {
          from: { opacity: '0', transform: 'scale(0.86)' },
          to: { opacity: '1', transform: 'none' },
        },
        halo: {
          '0%, 100%': { opacity: '0.35', transform: 'scale(0.92)' },
          '50%': { opacity: '0.7', transform: 'scale(1.06)' },
        },
        shimmer: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(100%)' },
        },
        pulse: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
      },
      animation: {
        'fade-in': 'fade-in 180ms cubic-bezier(0, 0, 0.2, 1)',
        rise: 'rise 420ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'splash-pop': 'splash-pop 560ms cubic-bezier(0.22, 1, 0.36, 1) both',
        halo: 'halo 2.6s ease-in-out infinite',
        shimmer: 'shimmer 1.25s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
