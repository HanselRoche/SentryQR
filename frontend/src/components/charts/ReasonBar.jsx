import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartColors } from '../../lib/colors.js';

/**
 * Horizontal distribution bars. Used for both audit event types and gate reason
 * codes, so the caller supplies the label function — `eventLabel` or
 * `reasonLabel` from lib/format.js — rather than this file restating either map.
 */
// Reason-code sentences run to ~60 characters and would wrap the axis to four
// lines. The tick is clipped; the tooltip still carries the whole sentence.
const TICK_MAX = 30;
const clip = (text) => (text.length > TICK_MAX ? `${text.slice(0, TICK_MAX - 1).trimEnd()}…` : text);

export default function ReasonBar({ data, label = (code) => code, colorFor, height = 260 }) {
  const colors = chartColors();

  if (!data?.length) return <p className="muted">Nothing to chart yet.</p>;

  const rows = data.map((row) => {
    const name = label(row.code);
    return { ...row, name, short: clip(name) };
  });

  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="short"
            width={186}
            tickLine={false}
            axisLine={false}
            tick={{ fill: colors.axis, fontSize: 12 }}
          />
          <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} content={<ReasonTooltip />} />
          <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={16} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell key={row.code} fill={colorFor?.(row.code) ?? colors.accent} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ReasonTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="chart-tooltip">
      <strong>{row.name}</strong>
      <span className="muted">
        {row.count} {row.count === 1 ? 'event' : 'events'} · <code>{row.code}</code>
      </span>
    </div>
  );
}
