import { ArrowUpRight } from 'lucide-react';

/**
 * A KPI tile. `tone="hero"` renders the filled-green variant — use it once per
 * strip, on the number that matters most, so the row has a single focal point.
 */
export default function StatTile({ label, value, hint, icon, tone = 'default' }) {
  return (
    <div className={`stat-tile${tone === 'hero' ? ' hero' : ''}`}>
      <div className="stat-arrow">{icon ?? <ArrowUpRight size={15} />}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function StatGrid({ children }) {
  return <div className="stat-grid">{children}</div>;
}
