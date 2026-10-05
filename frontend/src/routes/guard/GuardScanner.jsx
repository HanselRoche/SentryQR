import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, CameraOff, CheckCircle2, ScanLine, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatTime, reasonLabel } from '../../lib/format.js';
import { decisionSplit } from '../../lib/stats.js';
import PageHeader from '../../components/PageHeader.jsx';
import Card from '../../components/Card.jsx';
import Alert from '../../components/Alert.jsx';
import DataTable from '../../components/DataTable.jsx';
import StatTile, { StatGrid } from '../../components/StatTile.jsx';
import { DecisionBadge } from '../../components/Badge.jsx';

const READER_ID = 'qr-reader';
const RESULT_HOLD_MS = 4000;

function cameraErrorMessage(err) {
  const name = err?.name ?? '';
  const detail = err?.message ?? String(err);
  if (name === 'NotAllowedError' || /permission/i.test(detail)) {
    return 'Camera permission denied. Allow camera access for this site in the browser, then press Start again.';
  }
  if (name === 'NotReadableError') {
    return 'Camera is in use by another app or tab. Close it and press Start again.';
  }
  if (name === 'NotFoundError') {
    return 'No camera found on this device.';
  }
  return `Could not start the camera: ${detail}`;
}

const RECENT_COLUMNS = [
  { key: 'verifiedAt', header: 'Time', render: (entry) => formatTime(entry.verifiedAt) },
  {
    key: 'decision',
    header: 'Result',
    render: (entry) => <DecisionBadge decision={entry.decision} />,
  },
  { key: 'student', header: 'Student', render: (entry) => entry.student?.fullName ?? '—' },
  { key: 'reasonCode', header: 'Reason', render: (entry) => <code>{entry.reasonCode}</code> },
];

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
    if (scannerRef.current) return; // already starting or running
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'Camera unavailable: this page is not in a secure context. Use http://localhost, or enable HTTPS to scan from a phone over the network.',
      );
      return;
    }

    const scanner = new Html5Qrcode(READER_ID, {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    scannerRef.current = scanner;

    const config = {
      fps: 10,
      // The payload is a dense QR (signature + nonce), so scan most of the
      // frame rather than a small fixed box.
      qrbox: (width, height) => {
        const side = Math.floor(Math.min(width, height) * 0.8);
        return { width: side, height: side };
      },
    };

    // Prefer the rear camera, but desktops often have none and some browsers
    // reject the constraint outright — fall back to any available camera.
    const attempts = [{ facingMode: 'environment' }];
    try {
      const cameras = await Html5Qrcode.getCameras();
      if (cameras.length > 0) attempts.push({ deviceId: { exact: cameras[cameras.length - 1].id } });
    } catch {
      // Permission not granted yet; the first attempt will prompt for it.
    }
    attempts.push({ facingMode: 'user' });

    let lastError;
    for (const camera of attempts) {
      try {
        // html5-qrcode ignores the camera argument once videoConstraints is
        // set, so the camera choice goes inside the constraints. Webcams often
        // default to 640x480, too coarse for a dense QR, hence the ideal size.
        await scanner.start(
          camera,
          {
            ...config,
            videoConstraints: { ...camera, width: { ideal: 1280 }, height: { ideal: 720 } },
          },
          handleDecoded,
          () => {}, // per-frame decode misses are normal; ignore them
        );
        setScanning(true);
        return;
      } catch (err) {
        lastError = err;
        if (err?.name === 'NotAllowedError') break; // retrying won't help
      }
    }

    scannerRef.current = null;
    setError(cameraErrorMessage(lastError));
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

  const { total, grants, denials } = decisionSplit(recent);

  return (
    <>
      <PageHeader
        title="Gate scanner"
        subtitle="Hold a student's QR in frame. The server decides; this screen only reports."
        actions={
          scanning ? (
            <button className="secondary" onClick={stop}>
              <CameraOff size={15} />
              Stop camera
            </button>
          ) : (
            <button onClick={start}>
              <Camera size={15} />
              Start camera
            </button>
          )
        }
      />

      {result && <DecisionBanner result={result} />}
      {error && <Alert tone="error">{error}</Alert>}

      {total > 0 && (
        <StatGrid>
          <StatTile tone="hero" label="Scans this session" value={total} hint="Since page load" />
          <StatTile
            label="Granted"
            value={grants}
            icon={<CheckCircle2 size={15} />}
            hint="Signature verified"
          />
          <StatTile
            label="Denied"
            value={denials}
            icon={<XCircle size={15} />}
            hint="Blocked at the gate"
          />
        </StatGrid>
      )}

      <div className="grid-2">
        <Card title="Camera">
          {/* #qr-reader stays mounted either way — html5-qrcode looks it up by id. */}
          <div id={READER_ID} />

          {!scanning && (
            <div className="scanner-placeholder">
              <ScanLine size={30} />
              <strong>Camera is off</strong>
              <span>Start the camera and hold a student&apos;s QR in frame.</span>
            </div>
          )}

          <ManualEntry onSubmit={handleDecoded} />
        </Card>

        <Card title="Recent scans" subtitle="This session only — the full record lives in the audit log.">
          {recent.length === 0 ? (
            <p className="muted">Nothing scanned yet.</p>
          ) : (
            <DataTable
              columns={RECENT_COLUMNS}
              rows={recent}
              rowKey={(entry) => entry.entryEventId}
            />
          )}
        </Card>
      </div>
    </>
  );
}

function DecisionBanner({ result }) {
  const granted = result.decision === 'GRANT';

  return (
    <div className={`decision-banner ${granted ? 'grant' : 'deny'}`}>
      <div className="verdict">
        {granted ? <CheckCircle2 size={38} /> : <XCircle size={38} />}
        {granted ? 'ENTRY GRANTED' : 'ENTRY DENIED'}
      </div>

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
      <summary>
        <ScanLine size={14} />
        Paste a payload instead (no camera available)
      </summary>
      <form onSubmit={submit} style={{ marginTop: '0.7rem' }}>
        <textarea
          rows={3}
          value={payload}
          placeholder='{"v":1,"sid":2,"n":"…","iat":…,"sig":"…"}'
          onChange={(event) => setPayload(event.target.value)}
        />
        <button type="submit" className="secondary small" style={{ marginTop: '0.6rem' }}>
          Verify payload
        </button>
      </form>
    </details>
  );
}
