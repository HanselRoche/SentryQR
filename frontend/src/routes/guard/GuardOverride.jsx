import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api.js';
import PageHeader from '../../components/PageHeader.jsx';
import Card from '../../components/Card.jsx';
import Alert from '../../components/Alert.jsx';

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
    <>
      <PageHeader
        title="Manual override"
        subtitle="For a student who genuinely cannot present a QR — a flat battery, a lost phone."
      />

      <div className="grid-2">
        <Card title="Request an override">
          {error && <Alert tone="error">{error}</Alert>}
          {status && (
            <Alert tone="success">
              Request #{status.id} submitted for {status.studentName} ({status.rollNo}) and is
              awaiting admin approval.
            </Alert>
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
              <ShieldAlert size={15} />
              {busy ? 'Submitting…' : 'Submit for approval'}
            </button>
          </form>
        </Card>

        <Card title="This grants nothing on its own">
          <p className="muted" style={{ marginTop: 0 }}>
            An administrator must approve the request before the student is let through. Only the
            approval writes an entry event, and it is recorded against the student in exactly the
            same audit trail as a cryptographic verification.
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            The entry appears with reason code <code>MANUAL_OVERRIDE</code>, so a manual admission is
            always distinguishable from a signed one — never an invisible side channel.
          </p>
        </Card>
      </div>
    </>
  );
}
