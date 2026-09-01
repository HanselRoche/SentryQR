import { useEffect, useState } from 'react';
import { CheckCircle2, History, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatTime, reasonLabel } from '../../lib/format.js';
import { decisionSplit, topBy } from '../../lib/stats.js';
import { chartColors } from '../../lib/colors.js';
import PageHeader from '../../components/PageHeader.jsx';
import Card from '../../components/Card.jsx';
import Alert from '../../components/Alert.jsx';
import DataTable from '../../components/DataTable.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import StatTile, { StatGrid } from '../../components/StatTile.jsx';
import { DecisionBadge } from '../../components/Badge.jsx';
import DecisionDonut from '../../components/charts/DecisionDonut.jsx';
import ReasonBar from '../../components/charts/ReasonBar.jsx';

const COLUMNS = [
  { key: 'createdAt', header: 'When', render: (entry) => formatTime(entry.createdAt) },
  {
    key: 'decision',
    header: 'Result',
    render: (entry) => <DecisionBadge decision={entry.decision} />,
  },
  {
    key: 'reasonCode',
    header: 'Reason',
    className: 'wrap-cell',
    render: (entry) => reasonLabel(entry.reasonCode),
  },
  { key: 'guardName', header: 'Verified by', render: (entry) => entry.guardName ?? '—' },
];

export default function StudentHistory() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .myEntries()
      .then((data) => setEntries(data.entries))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <Alert tone="error">{error}</Alert>;

  const { total, grants, denials } = decisionSplit(entries ?? []);

  return (
    <>
      <PageHeader
        title="Entry history"
        subtitle="Every attempt on your account, granted or denied. A denial you do not recognise is worth reporting — it may mean someone tried to use a copy of your QR."
      />

      {entries && entries.length > 0 && (
        <>
          <StatGrid>
            <StatTile
              tone="hero"
              label="Total attempts"
              value={total}
              hint="On your account"
            />
            <StatTile
              label="Granted"
              value={grants}
              icon={<CheckCircle2 size={15} />}
              hint="Verified at the gate"
            />
            <StatTile
              label="Denied"
              value={denials}
              icon={<XCircle size={15} />}
              hint="Blocked before entry"
            />
          </StatGrid>

          <div className="grid-2">
            <Card title="Grant rate" subtitle="Across every attempt on your account.">
              <DecisionDonut entries={entries} />
            </Card>

            <Card
              title="Why entries were denied"
              subtitle="A reason you cannot account for is worth reporting."
            >
              <ReasonBar
                data={topBy(
                  entries.filter((entry) => entry.decision === 'DENY'),
                  'reasonCode',
                  6,
                )}
                label={reasonLabel}
                colorFor={() => chartColors().deny}
                height={210}
              />
            </Card>
          </div>
        </>
      )}

      <Card title="Full history">
        <DataTable
          columns={COLUMNS}
          rows={entries}
          loading={!entries}
          empty={
            <EmptyState icon={History} title="No entry attempts yet">
              Once a guard scans your QR at the gate, every decision — granted or denied — shows up
              here.
            </EmptyState>
          }
        />
      </Card>
    </>
  );
}
