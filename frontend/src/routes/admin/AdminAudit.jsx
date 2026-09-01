import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { EVENT_TYPES, eventLabel, formatTime, reasonLabel } from '../../lib/format.js';

const PAGE = 100;

export default function AdminAudit() {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ eventType: '', decision: '' });
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .auditLog({ ...filters, limit: PAGE, offset })
      .then(setData)
      .catch((err) => setError(err.message));
  }, [filters, offset]);

  const update = (field) => (event) => {
    setOffset(0);
    setFilters({ ...filters, [field]: event.target.value });
  };

  return (
    <div className="card">
      <h2>Audit log</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Append-only record of every security-relevant event: logins, key lifecycle, challenges, and
        every gate decision with its reason code. Filter to <code>VERIFY</code> +{' '}
        <code>DENY</code> to see blocked attacks.
      </p>

      {error && <div className="alert error">{error}</div>}

      <div className="row" style={{ marginBottom: '1rem' }}>
        <div className="field" style={{ maxWidth: 220 }}>
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
        <div className="field" style={{ maxWidth: 180 }}>
          <label htmlFor="decision">Decision</label>
          <select id="decision" value={filters.decision} onChange={update('decision')}>
            <option value="">Any</option>
            <option value="GRANT">Granted</option>
            <option value="DENY">Denied</option>
          </select>
        </div>
      </div>

      {!data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <p className="muted">
            {data.total} matching {data.total === 1 ? 'event' : 'events'}
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Actor</th>
                  <th>Subject</th>
                  <th>Result</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((entry) => (
                  <tr key={entry.id}>
                    <td className="muted">{formatTime(entry.ts)}</td>
                    <td>{eventLabel(entry.eventType)}</td>
                    <td>{entry.actorName ?? entry.detail?.username ?? '—'}</td>
                    <td>{entry.subjectName ?? '—'}</td>
                    <td>
                      {entry.decision ? (
                        <span className={`badge ${entry.decision === 'GRANT' ? 'grant' : 'deny'}`}>
                          {entry.decision}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>
                      {entry.reasonCode ? (
                        <>
                          <code>{entry.reasonCode}</code>
                          <div className="muted" style={{ fontSize: '0.78rem' }}>
                            {reasonLabel(entry.reasonCode)}
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ marginTop: '1rem' }}>
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
          </div>
        </>
      )}
    </div>
  );
}
