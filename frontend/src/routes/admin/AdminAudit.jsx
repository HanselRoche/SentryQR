import { useEffect, useMemo, useState } from 'react';
import { ScrollText, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { EVENT_TYPES, eventLabel, formatTime, reasonLabel } from '../../lib/format.js';
import { topBy } from '../../lib/stats.js';
import { chartColors } from '../../lib/colors.js';
import PageHeader from '../../components/PageHeader.jsx';
import Card from '../../components/Card.jsx';
import Alert from '../../components/Alert.jsx';
import DataTable from '../../components/DataTable.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import StatTile, { StatGrid } from '../../components/StatTile.jsx';
import { DecisionBadge } from '../../components/Badge.jsx';
import ReasonBar from '../../components/charts/ReasonBar.jsx';
import { usePageSearch } from '../../components/Layout.jsx';

const PAGE = 100;
// The chart samples a wider window than the visible page, and is labelled as a
// sample rather than as an all-time total — /api/admin/audit only returns a
// `total` for the current filter, and there is no aggregate endpoint.
const SAMPLE = 500;

export default function AdminAudit() {
  const [data, setData] = useState(null);
  const [sample, setSample] = useState(null);
  const [filters, setFilters] = useState({ eventType: '', decision: '' });
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState(null);

  const query = usePageSearch('Search actor, subject or reason code');

  useEffect(() => {
    api
      .auditLog({ ...filters, limit: PAGE, offset })
      .then(setData)
      .catch((err) => setError(err.message));
  }, [filters, offset]);

  // Unfiltered, fetched once — the chart should not change shape as the reader
  // narrows the table below it.
  useEffect(() => {
    api
      .auditLog({ limit: SAMPLE, offset: 0 })
      .then(setSample)
      .catch(() => {});
  }, []);

  const update = (field) => (event) => {
    setOffset(0);
    setFilters({ ...filters, [field]: event.target.value });
  };

  const logs = sample?.logs ?? [];
  const distribution = topBy(logs, 'eventType', 8);
  const colors = chartColors();
  const colorFor = (code) => {
    if (code === 'LOGIN_FAILURE' || code === 'RATE_LIMITED' || code === 'KEY_REVOKED') {
      return colors.deny;
    }
    if (code === 'VERIFY') return colors.warn;
    return colors.accent;
  };

  const denials = logs.filter((entry) => entry.decision === 'DENY').length;
  const verifications = logs.filter((entry) => entry.eventType === 'VERIFY').length;

  const visible = useMemo(() => {
    if (!data) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return data.logs;
    return data.logs.filter((entry) =>
      [entry.actorName, entry.subjectName, entry.reasonCode, entry.eventType, entry.detail?.username]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [data, query]);

  const columns = [
    { key: 'ts', header: 'Time', className: 'muted', render: (entry) => formatTime(entry.ts) },
    { key: 'eventType', header: 'Event', render: (entry) => eventLabel(entry.eventType) },
    {
      key: 'actor',
      header: 'Actor',
      render: (entry) => entry.actorName ?? entry.detail?.username ?? '—',
    },
    { key: 'subject', header: 'Subject', render: (entry) => entry.subjectName ?? '—' },
    {
      key: 'decision',
      header: 'Result',
      render: (entry) => (entry.decision ? <DecisionBadge decision={entry.decision} /> : '—'),
    },
    {
      key: 'reason',
      header: 'Reason',
      className: 'wrap-cell',
      // Both halves stay: the code maps back to the threat model during a demo,
      // the sentence is what a person can act on.
      render: (entry) =>
        entry.reasonCode ? (
          <>
            <code>{entry.reasonCode}</code>
            <div className="muted" style={{ fontSize: '0.76rem' }}>
              {reasonLabel(entry.reasonCode)}
            </div>
          </>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Append-only record of every security-relevant event: logins, key lifecycle, challenges, and every gate decision with its reason code."
      />

      <StatGrid>
        <StatTile
          tone="hero"
          label="Events recorded"
          value={data?.total ?? '—'}
          icon={<ScrollText size={15} />}
          hint={filters.eventType || filters.decision ? 'Matching the filter' : 'All time'}
        />
        <StatTile
          label="Gate verifications"
          value={verifications}
          icon={<ShieldCheck size={15} />}
          hint={`In the last ${SAMPLE} events`}
        />
        <StatTile
          label="Denied"
          value={denials}
          icon={<XCircle size={15} />}
          hint="Attacks blocked before entry"
        />
      </StatGrid>

      {error && <Alert tone="error">{error}</Alert>}

      <Card
        title="Event distribution"
        subtitle={`Across the ${logs.length} most recent events, unfiltered. Red bars are the security-relevant ones.`}
      >
        <ReasonBar data={distribution} label={eventLabel} colorFor={colorFor} height={260} />
      </Card>

      <Card
        title="Events"
        subtitle={
          <>
            Filter to <code>VERIFY</code> + <code>DENY</code> to see blocked attacks.
          </>
        }
        action={
          <div className="filters">
            <div className="field" style={{ maxWidth: 210 }}>
              <label htmlFor="eventType">Event type</label>
              <select id="eventType" value={filters.eventType} onChange={update('eventType')}>
                <option value="">All events</option>
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {eventLabel(type)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ maxWidth: 160 }}>
              <label htmlFor="decision">Decision</label>
              <select id="decision" value={filters.decision} onChange={update('decision')}>
                <option value="">Any</option>
                <option value="GRANT">Granted</option>
                <option value="DENY">Denied</option>
              </select>
            </div>
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={visible}
          loading={!data}
          empty={
            <EmptyState icon={ScrollText} title="No matching events">
              Widen the filter or clear the search to see more.
            </EmptyState>
          }
        />

        {data && (
          <div className="row" style={{ marginTop: '1.1rem', alignItems: 'center' }}>
            <button
              className="secondary small"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
            >
              Previous
            </button>
            <button
              className="secondary small"
              disabled={offset + PAGE >= data.total}
              onClick={() => setOffset(offset + PAGE)}
            >
              Next
            </button>
            <span className="muted">
              {data.total === 0
                ? 'No events'
                : `${offset + 1}–${Math.min(offset + PAGE, data.total)} of ${data.total}`}
            </span>
          </div>
        )}
      </Card>
    </>
  );
}
