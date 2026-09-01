import { useState } from 'react';
import { api } from '../../lib/api.js';

/**
 * The edge case the roadmap calls out: a student with a dead phone.
 *
 * A guard cannot grant entry here. The request goes to an admin, and only an
 * approval writes an entry event — so a manual entry is recorded in exactly the
 * same audit trail as a cryptographic one, never as an invisible side channel.
 */
export default function GuardOverride() {
  const [rollNo, setRollNo] = useState('');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const data = await api.requestOverride(rollNo.trim(), reason.trim());
      setStatus(data.override);
      setRollNo('');
      setReason('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Request manual override</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        For a student who genuinely cannot present a QR — a flat battery, a lost phone. This grants
        nothing on its own: an administrator must approve it, and the approval is logged against the
        student like any other entry.
      </p>

      {error && <div className="alert error">{error}</div>}
      {status && (
        <div className="alert success">
          Request #{status.id} submitted for {status.studentName} ({status.rollNo}) and is awaiting
          admin approval.
        </div>
      )}

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="rollNo">Student roll number</label>
          <input
            id="rollNo"
            value={rollNo}
            onChange={(event) => setRollNo(event.target.value)}
            placeholder="4SO22CS001"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="reason">Reason (recorded in the audit log)</label>
          <textarea
            id="reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Phone battery dead — student ID card checked visually"
            minLength={5}
            required
          />
        </div>

        <button type="submit" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit for approval'}
        </button>
      </form>
    </div>
  );
}
