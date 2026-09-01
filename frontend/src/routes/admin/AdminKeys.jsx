import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { formatTime } from '../../lib/format.js';

export default function AdminKeys() {
  const [keys, setKeys] = useState(null);
  const [includeRevoked, setIncludeRevoked] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = (revoked) =>
    api
      .listKeys(revoked)
      .then((data) => setKeys(data.keys))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load(includeRevoked);
  }, [includeRevoked]);

  const revoke = async (key) => {
    setError(null);
    setNotice(null);
    try {
      await api.revokeKey(key.id);
      setNotice(
        `Revoked ${key.kid} for ${key.ownerName}. Their next scan will be denied with KEY_REVOKED.`,
      );
      await load(includeRevoked);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="card">
      <h2>Public key registry</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        The simulated certificate authority. Only public keys are stored — a private key never
        reaches this server, so it cannot be leaked from here. Revocation is immediate and takes
        effect on the very next verification.
      </p>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <label style={{ marginBottom: '0.75rem' }}>
        <input
          type="checkbox"
          checked={includeRevoked}
          onChange={(event) => setIncludeRevoked(event.target.checked)}
          style={{ width: 'auto', marginRight: '0.4rem' }}
        />
        Show revoked keys
      </label>

      {!keys ? (
        <p className="muted">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="muted">No keys enrolled yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Owner</th>
                <th>Key ID</th>
                <th>Algorithm</th>
                <th>Public point</th>
                <th>Enrolled</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td>
                    {key.ownerName}
                    <div className="muted mono">{key.rollNo ?? key.ownerUsername}</div>
                  </td>
                  <td className="mono">{key.kid}</td>
                  <td className="muted">{key.algorithm}</td>
                  <td className="mono muted">{key.publicPreview}</td>
                  <td className="muted">{formatTime(key.createdAt)}</td>
                  <td>
                    <span className={`badge ${key.active ? 'grant' : 'deny'}`}>
                      {key.active ? 'active' : 'revoked'}
                    </span>
                    {!key.active && key.revokedAt && (
                      <div className="muted" style={{ fontSize: '0.75rem' }}>
                        {formatTime(key.revokedAt)}
                      </div>
                    )}
                  </td>
                  <td>
                    {key.active && (
                      <button className="danger small" onClick={() => revoke(key)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
