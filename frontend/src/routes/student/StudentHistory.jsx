import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { formatTime, reasonLabel } from '../../lib/format.js';

export default function StudentHistory() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .myEntries()
      .then((data) => setEntries(data.entries))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="alert error">{error}</div>;
  if (!entries) return <p className="muted">Loading…</p>;

  return (
    <div className="card">
      <h2>Entry history</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Every attempt on your account, granted or denied. A denial you do not recognise is worth
        reporting — it may mean someone tried to use a copy of your QR.
      </p>

      {entries.length === 0 ? (
        <p className="muted">No entry attempts recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Result</th>
                <th>Reason</th>
                <th>Verified by</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatTime(entry.createdAt)}</td>
                  <td>
                    <span className={`badge ${entry.decision === 'GRANT' ? 'grant' : 'deny'}`}>
                      {entry.decision}
                    </span>
                  </td>
                  <td>{reasonLabel(entry.reasonCode)}</td>
                  <td>{entry.guardName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
