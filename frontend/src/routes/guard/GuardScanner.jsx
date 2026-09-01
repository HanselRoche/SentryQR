import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '../../lib/api.js';
import { formatTime, reasonLabel } from '../../lib/format.js';

const READER_ID = 'qr-reader';
const RESULT_HOLD_MS = 4000;

/**
 * The guard terminal.
 *
 * This screen decides nothing. It decodes a QR, hands the raw string to the
 * server, and displays whatever verdict comes back. A compromised guard device
 * could fake this banner, but it could not create a genuine entry record —
 * every decision in entry_events came from the server.
 */
export default function GuardScanner() {
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [recent, setRecent] = useState([]);

  const scannerRef = useRef(null);
  // Guards against the scanner firing repeatedly on the same frame while a
  // verification request is still in flight.
  const busyRef = useRef(false);
  const resultTimer = useRef(null);

  const handleDecoded = useCallback(async (raw) => {
    if (busyRef.current) return;
    busyRef.current = true;

    try {
      // Passed through verbatim — parsing client-side risks normalising
      // something the signature covers.
      const decision = await api.verify(raw);
      setResult(decision);
      setRecent((previous) => [decision, ...previous].slice(0, 8));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      clearTimeout(resultTimer.current);
      resultTimer.current = setTimeout(() => {
        setResult(null);
        busyRef.current = false;
      }, RESULT_HOLD_MS);
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const scanner = new Html5Qrcode(READER_ID, { verbose: false });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        handleDecoded,
        () => {}, // per-frame decode misses are normal; ignore them
      );
      setScanning(true);
    } catch (err) {
      setError(
        `Could not start the camera: ${err?.message ?? err}. ` +
          'Camera access needs a secure context — use http://localhost, or enable HTTPS to scan from a phone over the network.',
      );
    }
  }, [handleDecoded]);

  const stop = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    setScanning(false);
    if (!scanner) return;
    try {
      await scanner.stop();
      scanner.clear();
    } catch {
      // Already stopped.
    }
  }, []);

  // Release the camera on unmount, or the light stays on after navigating away.
  useEffect(() => () => {
    clearTimeout(resultTimer.current);
    const scanner = scannerRef.current;
    if (scanner) scanner.stop().then(() => scanner.clear()).catch(() => {});
  }, []);

  return (
    <>
      {result && <DecisionBanner result={result} />}
      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Gate scanner</h2>
          {scanning ? (
            <button className="secondary small" onClick={stop}>
              Stop camera
            </button>
          ) : (
            <button onClick={start}>Start camera</button>
          )}
        </div>

        <div id={READER_ID} />

        {!scanning && (
          <p className="muted center" style={{ marginTop: '1rem' }}>
            Start the camera and hold a student&apos;s QR in frame.
          </p>
        )}

        <ManualEntry onSubmit={handleDecoded} />
      </div>

      {recent.length > 0 && (
        <div className="card">
          <h2>Recent scans</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Result</th>
                  <th>Student</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((entry) => (
                  <tr key={entry.entryEventId}>
                    <td>{formatTime(entry.verifiedAt)}</td>
                    <td>
                      <span className={`badge ${entry.decision === 'GRANT' ? 'grant' : 'deny'}`}>
                        {entry.decision}
                      </span>
                    </td>
                    <td>{entry.student?.fullName ?? '—'}</td>
                    <td>
                      <code>{entry.reasonCode}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function DecisionBanner({ result }) {
  const granted = result.decision === 'GRANT';

  return (
    <div className={`decision-banner ${granted ? 'grant' : 'deny'}`}>
      <div className="verdict">{granted ? 'ENTRY GRANTED' : 'ENTRY DENIED'}</div>

      {granted && result.student ? (
        <div className="who">
          {result.student.fullName}
          <div className="muted">
            {result.student.rollNo} · Room {result.student.roomNo} · Block{' '}
            {result.student.hostelBlock}
          </div>
        </div>
      ) : (
        <div className="who">{reasonLabel(result.reasonCode)}</div>
      )}

      <div className="reason-code">{result.reasonCode}</div>
    </div>
  );
}

/** Fallback for demos on a machine without a working camera. */
function ManualEntry({ onSubmit }) {
  const [payload, setPayload] = useState('');

  const submit = (event) => {
    event.preventDefault();
    if (!payload.trim()) return;
    onSubmit(payload.trim());
    setPayload('');
  };

  return (
    <details style={{ marginTop: '1rem' }}>
      <summary className="muted" style={{ cursor: 'pointer' }}>
        Paste a payload instead (no camera available)
      </summary>
      <form onSubmit={submit} style={{ marginTop: '0.6rem' }}>
        <textarea
          rows={3}
          value={payload}
          placeholder='{"v":1,"sid":2,"n":"…","iat":…,"sig":"…"}'
          onChange={(event) => setPayload(event.target.value)}
        />
        <button type="submit" className="secondary small" style={{ marginTop: '0.5rem' }}>
          Verify payload
        </button>
      </form>
    </details>
  );
}
