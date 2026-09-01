/**
 * Chart colours, read from the CSS custom properties in styles.css.
 *
 * recharts wants concrete colour strings, not `var(--grant)`. Resolving them
 * from the stylesheet keeps the charts in step with the badges and banners —
 * editing the palette in one place stays enough.
 */
const FALLBACKS = {
  '--accent': '#1b7a4b',
  '--accent-strong': '#0f5c37',
  '--grant': '#1b9e5f',
  '--deny': '#dc2b2b',
  '--warn': '#d98217',
  '--border': '#e3e7e3',
  '--surface-2': '#eef1ee',
  '--text-dim': '#6b7770',
};

export function token(name) {
  if (typeof window === 'undefined') return FALLBACKS[name];
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || FALLBACKS[name];
}

export const chartColors = () => ({
  accent: token('--accent'),
  grant: token('--grant'),
  deny: token('--deny'),
  warn: token('--warn'),
  grid: token('--border'),
  axis: token('--text-dim'),
});
