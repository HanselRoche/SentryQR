import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { chartColors } from '../../lib/colors.js';
import { decisionSplit } from '../../lib/stats.js';

/** Grant vs deny, with the grant rate in the hole. */
export default function DecisionDonut({ entries }) {
  const { grants, denials, rate, total } = decisionSplit(entries);
  const colors = chartColors();

  if (total === 0) return <p className="muted">No decisions recorded yet.</p>;

  const data = [
    { name: 'Granted', value: grants, fill: colors.grant },
    { name: 'Denied', value: denials, fill: colors.deny },
  ].filter((slice) => slice.value > 0);

  return (
    <div>
      <div className="chart-box" style={{ height: 210, position: 'relative' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="66%"
              outerRadius="94%"
              paddingAngle={data.length > 1 ? 3 : 0}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((slice) => (
                <Cell key={slice.name} fill={slice.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
          }}
        >
          <div className="center">
            <div style={{ fontSize: '1.9rem', fontWeight: 700, letterSpacing: '-0.04em' }}>
              {rate}%
            </div>
            <div className="muted" style={{ fontSize: '0.78rem' }}>
              granted
            </div>
          </div>
        </div>
      </div>

      <div className="chart-legend">
        <span>
          <i style={{ background: colors.grant }} /> Granted · {grants}
        </span>
        <span>
          <i style={{ background: colors.deny }} /> Denied · {denials}
        </span>
      </div>
    </div>
  );
}
