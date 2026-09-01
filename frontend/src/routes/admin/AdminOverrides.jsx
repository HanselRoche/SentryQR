import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { formatTime } from '../../lib/format.js';

export default function AdminOverrides() {
  const [overrides, setOverrides] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [notes, setNotes] = useState({});
  const [error, setError] = useState(null);

  const load = (status) =>
    api
      .listOverrides(status)
      .then((data) => setOverrides(data.overrides))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load(filter);
  }, [filter]);

  const decide = async (id, approve) => {
    setError(null);
    try {
      await api.decideOverride(id, approve, notes[id] ?? '');
      setNotes({ ...notes, [id]: '' });
      await load(filter);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="card">
      <h2>Manual override requests</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Approving one writes a real entry event with reason <code>MANUAL_OVERRIDE</code> against the
        student, so a manual entry appears in the audit trail beside cryptographic ones.
      </p>

      {error && <div className="alert error">{error}</div>}

      <div className="field" style={{ maxWidth: 220 }}>
        <label htmlFor="filter">Status</label>
        <select id="filter" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
        </select>
      </div>

      {!overrides ? (
        <p className="muted">Loading…</p>
      ) : overrides.length === 0 ? (
        <p className="muted">No {filter} requests.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Requested</th>
                <th>Student</th>
                <th>Guard</th>
                <th>Reason</th>
                {filter === 'pending' ? <th>Note &amp; decision</th> : <th>Outcome</th>}
              </tr>
            </thead>
            <tbody>
              {overrides.map((item) => (
                <tr key={item.id}>
                  <td className="muted">{formatTime(item.createdAt)}</td>
                  <td>
                    {item.studentName}
                    <div className="muted mono">
                      {item.rollNo} · {item.roomNo}
                    </div>
                  </td>
                  <td>{item.guardName}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 280 }}>{item.reason}</td>
                  {filter === 'pending' ? (
                    <td style={{ whiteSpace: 'normal', minWidth: 260 }}>
                      <input
                        placeholder="Note (optional)"
                        value={notes[item.id] ?? ''}
                        onChange={(event) => setNotes({ ...notes, [item.id]: event.target.value })}
                        style={{ marginBottom: '0.4rem' }}
                      />
                      <div className="row">
                        <button className="small" onClick={() => decide(item.id, true)}>
                          Approve
                        </button>
                        <button className="danger small" onClick={() => decide(item.id, false)}>
                          Deny
                        </button>
                      </div>
                    </td>
                  ) : (
                    <td>
                      <span className={`badge ${item.status === 'approved' ? 'grant' : 'deny'}`}>
                        {item.status}
                      </span>
                      <div className="muted" style={{ fontSize: '0.78rem' }}>
                        {item.decidedByName} · {formatTime(item.decidedAt)}
                      </div>
                      {item.decisionNote && <div className="muted">{item.decisionNote}</div>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
