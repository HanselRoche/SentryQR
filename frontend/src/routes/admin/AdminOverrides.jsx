import { useEffect, useState } from 'react';
import { CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatTime } from '../../lib/format.js';
import PageHeader from '../../components/PageHeader.jsx';
import Card from '../../components/Card.jsx';
import Alert from '../../components/Alert.jsx';
import Avatar from '../../components/Avatar.jsx';
import Badge from '../../components/Badge.jsx';
import DataTable from '../../components/DataTable.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import StatTile, { StatGrid } from '../../components/StatTile.jsx';

const STATUSES = ['pending', 'approved', 'denied'];

export default function AdminOverrides() {
  // The endpoint filters by a single status, so fetch all three once and switch
  // between them locally — the tiles need every count anyway.
  const [byStatus, setByStatus] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [notes, setNotes] = useState({});
  const [error, setError] = useState(null);

  const load = () =>
    Promise.all(STATUSES.map((status) => api.listOverrides(status)))
      .then((results) =>
        setByStatus(
          Object.fromEntries(STATUSES.map((status, index) => [status, results[index].overrides])),
        ),
      )
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  const decide = async (id, approve) => {
    setError(null);
    try {
      await api.decideOverride(id, approve, notes[id] ?? '');
      setNotes({ ...notes, [id]: '' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const rows = byStatus?.[filter] ?? null;
  const counts = {
    pending: byStatus?.pending.length ?? 0,
    approved: byStatus?.approved.length ?? 0,
    denied: byStatus?.denied.length ?? 0,
  };

  const baseColumns = [
    {
      key: 'createdAt',
      header: 'Requested',
      className: 'muted',
      render: (item) => formatTime(item.createdAt),
    },
    {
      key: 'student',
      header: 'Student',
      render: (item) => (
        <div className="cell-person">
          <Avatar name={item.studentName} size="sm" />
          <div className="who">
            <strong>{item.studentName}</strong>
            <small className="mono">
              {item.rollNo} · {item.roomNo}
            </small>
          </div>
        </div>
      ),
    },
    { key: 'guardName', header: 'Guard' },
    { key: 'reason', header: 'Reason', className: 'wrap-cell' },
  ];

  const decisionColumn =
    filter === 'pending'
      ? {
          key: 'decide',
          header: 'Note & decision',
          className: 'wrap-cell',
          render: (item) => (
            <div style={{ minWidth: 240 }}>
              <input
                placeholder="Note (optional)"
                value={notes[item.id] ?? ''}
                onChange={(event) => setNotes({ ...notes, [item.id]: event.target.value })}
                style={{ marginBottom: '0.45rem' }}
              />
              <div className="row">
                <button className="small" onClick={() => decide(item.id, true)}>
                  <CheckCircle2 size={14} />
                  Approve
                </button>
                <button className="danger small" onClick={() => decide(item.id, false)}>
                  <XCircle size={14} />
                  Deny
                </button>
              </div>
            </div>
          ),
        }
      : {
          key: 'outcome',
          header: 'Outcome',
          className: 'wrap-cell',
          render: (item) => (
            <>
              <Badge tone={item.status === 'approved' ? 'grant' : 'deny'}>{item.status}</Badge>
              <div className="muted" style={{ fontSize: '0.76rem' }}>
                {item.decidedByName} · {formatTime(item.decidedAt)}
              </div>
              {item.decisionNote && <div className="muted">{item.decisionNote}</div>}
            </>
          ),
        };

  return (
    <>
      <PageHeader
        title="Manual overrides"
        subtitle="Approving one writes a real entry event with reason MANUAL_OVERRIDE against the student, so a manual entry appears in the audit trail beside cryptographic ones."
      />

      <StatGrid>
        <StatTile
          tone="hero"
          label="Awaiting decision"
          value={counts.pending}
          icon={<ShieldAlert size={15} />}
          hint="Nobody enters until you decide"
        />
        <StatTile
          label="Approved"
          value={counts.approved}
          icon={<CheckCircle2 size={15} />}
          hint="Logged as MANUAL_OVERRIDE"
        />
        <StatTile
          label="Denied"
          value={counts.denied}
          icon={<XCircle size={15} />}
          hint="No entry event written"
        />
      </StatGrid>

      {error && <Alert tone="error">{error}</Alert>}

      <Card
        title="Requests"
        action={
          <div className="filters">
            {STATUSES.map((status) => (
              <button
                key={status}
                className={filter === status ? 'small' : 'secondary small'}
                onClick={() => setFilter(status)}
                style={{ textTransform: 'capitalize' }}
              >
                {status} · {counts[status]}
              </button>
            ))}
          </div>
        }
      >
        <DataTable
          columns={[...baseColumns, decisionColumn]}
          rows={rows}
          loading={!byStatus}
          empty={
            <EmptyState icon={ShieldAlert} title={`No ${filter} requests`}>
              {filter === 'pending'
                ? 'Nothing is waiting on you right now.'
                : `No request has been ${filter} yet.`}
            </EmptyState>
          }
        />
      </Card>
    </>
  );
}
