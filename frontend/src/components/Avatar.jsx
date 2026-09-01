// A small fixed palette rather than a random hue: adjacent rows in a table stay
// distinguishable, and the colours are all legible against white.
const PALETTE = [
  ['#e6f4ec', '#0f5c37'],
  ['#e7effb', '#1d4d8f'],
  ['#fdeee2', '#8a5210'],
  ['#f3e9fb', '#5c2d86'],
  ['#fde9ec', '#8f1a3a'],
  ['#e4f4f5', '#0f5a63'],
];

const initials = (name) =>
  (name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase() || '?';

const hash = (value) => {
  let sum = 0;
  for (const char of value ?? '') sum = (sum + char.charCodeAt(0)) % 997;
  return sum;
};

export default function Avatar({ name, size = 'md' }) {
  const [background, color] = PALETTE[hash(name) % PALETTE.length];

  return (
    <span
      className={`avatar${size === 'sm' ? ' sm' : ''}`}
      style={{ background, color }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
