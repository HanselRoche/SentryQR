import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../../lib/api.js';
import {
  buildQrPayload,
  clearKeyPair,
  generateDeviceKey,
  loadKeyPair,
  provePrivateKeyIsNonExtractable,
  saveKeyPair,
  signChallenge,
} from '../../lib/webcrypto.js';

// Refresh well before expiry so a scan never lands on a QR that goes stale
// mid-frame. With a 45s server TTL this leaves ~15s of slack.
const REFRESH_LEAD_MS = 15_000;

export default function StudentHome() {
  const [profile, setProfile] = useState(null);
  const [deviceKey, setDeviceKey] = useState(null);
  const [challenge, setChallenge] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refreshTimer = useRef(null);

  useEffect(() => {
    Promise.all([api.studentProfile(), loadKeyPair()])
      .then(([data, stored]) => {
        setProfile(data);
        setDeviceKey(stored);
      })
      .catch((err) => setError(err.message));
  }, []);

  /** Request a challenge, sign it locally, build the QR payload. */
  const refresh = useCallback(async () => {
    if (!deviceKey) return;
    try {
      const issued = await api.requestChallenge();
      const signature = await signChallenge(deviceKey.privateKey, issued.message);

      setChallenge({
        ...issued,
        payload: buildQrPayload({
          studentId: issued.studentId,
          nonce: issued.nonce,
          issuedAt: issued.issuedAt,
          signature,
        }),
      });
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [deviceKey]);

  useEffect(() => {
    if (deviceKey) refresh();
  }, [deviceKey, refresh]);

  // Schedule the next refresh from the challenge's own expiry rather than a
  // fixed interval, so a slow request or clock drift cannot leave a stale QR up.
  useEffect(() => {
    if (!challenge) return undefined;

    const delay = Math.max(challenge.expiresAt - Date.now() - REFRESH_LEAD_MS, 2000);
    refreshTimer.current = setTimeout(refresh, delay);
    return () => clearTimeout(refreshTimer.current);
  }, [challenge, refresh]);

  const enrolDevice = async () => {
    setBusy(true);
    setError(null);
    try {
      const generated = await generateDeviceKey();
      const { key } = await api.registerKey(generated.publicJwk);

      await saveKeyPair({
        privateKey: generated.privateKey,
        publicKey: generated.publicKey,
        kid: key.kid,
      });

      setDeviceKey(await loadKeyPair());
      setProfile(await api.studentProfile());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resetDevice = async () => {
    await clearKeyPair();
    setDeviceKey(null);
    setChallenge(null);
    setProfile(await api.studentProfile());
  };

  if (error && !profile) return <div className="alert error">{error}</div>;
  if (!profile) return <p className="muted">Loading…</p>;

  // Enrolment is needed when this browser holds no key, or when the server's
  // active key is a different one — which happens after enrolling elsewhere or
  // after an admin revokes this key.
  const serverKid = profile.activeKey?.kid ?? null;
  const needsEnrolment = !deviceKey || !serverKid || deviceKey.kid !== serverKid;

  return (
    <>
      <div className="card">
        <h2>{profile.user.fullName}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {profile.student?.rollNo} · Room {profile.student?.roomNo} · Block{' '}
          {profile.student?.hostelBlock}
        </p>
      </div>

      {error && <div className="alert error">{error}</div>}

      {needsEnrolment ? (
        <EnrolmentCard
          busy={busy}
          onEnrol={enrolDevice}
          hasLocalKey={Boolean(deviceKey)}
          serverHasKey={Boolean(serverKid)}
          mismatched={Boolean(deviceKey && serverKid && deviceKey.kid !== serverKid)}
        />
      ) : (
        <QrCard
          challenge={challenge}
          deviceKey={deviceKey}
          onRefresh={refresh}
          onReset={resetDevice}
        />
      )}
    </>
  );
}

function EnrolmentCard({ busy, onEnrol, hasLocalKey, serverHasKey, mismatched }) {
  return (
    <div className="card">
      <h2>Enrol this device</h2>

      {mismatched && (
        <div className="alert error">
          The key stored in this browser is no longer the one registered on the server. It was either
          revoked by an administrator, or superseded when you enrolled a different device. Enrol
          again to continue.
        </div>
      )}
      {!hasLocalKey && serverHasKey && !mismatched && (
        <div className="alert info">
          Your account has a registered key, but it belongs to a different browser or device. Keys
          cannot be copied between devices — that is precisely what stops credential sharing. Enrol
          this device to give it its own key.
        </div>
      )}

      <p className="muted">
        This generates an ECDSA P-256 keypair inside your browser. The private half is marked{' '}
        <strong>non-extractable</strong>: it lives as an opaque handle in IndexedDB and cannot be
        exported, copied, screenshotted, or sent anywhere — not even by this page&apos;s own code.
        Only the public half reaches the server.
      </p>

      <button onClick={onEnrol} disabled={busy}>
        {busy ? 'Generating keypair…' : 'Generate key and enrol'}
      </button>
    </div>
  );
}

function QrCard({ challenge, deviceKey, onRefresh, onReset }) {
  const canvasRef = useRef(null);
  const [remaining, setRemaining] = useState(0);
  const [proof, setProof] = useState(null);

  // Draw whenever the payload changes.
  useEffect(() => {
    if (!challenge || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, challenge.payload, {
      width: 560,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => {});
  }, [challenge]);

  useEffect(() => {
    if (!challenge) return undefined;
    const tick = () => setRemaining(Math.max(0, challenge.expiresAt - Date.now()));
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [challenge]);

  if (!challenge) return <p className="muted">Requesting a challenge…</p>;

  const seconds = Math.ceil(remaining / 1000);
  const total = challenge.expiresAt - challenge.issuedAt;
  const percent = Math.max(0, Math.min(100, (remaining / total) * 100));
  const expired = remaining <= 0;
  const ringColor = percent > 50 ? 'var(--grant)' : percent > 20 ? 'var(--warn)' : 'var(--deny)';

  const checkExtractability = async () => {
    setProof(await provePrivateKeyIsNonExtractable(deviceKey.privateKey));
  };

  return (
    <>
      <div className="card">
        <div className="qr-stage">
          <div className={`qr-frame${expired ? ' stale' : ''}`}>
            <canvas ref={canvasRef} />
          </div>

          <div className="countdown">
            <div
              className="countdown-ring"
              data-seconds={expired ? '0' : seconds}
              style={{ '--pct': percent, '--ring-color': ringColor }}
            />
            <div>
              <strong>{expired ? 'Expired — refreshing' : `Valid for ${seconds}s`}</strong>
              <div className="muted">Refreshes automatically · single use only</div>
            </div>
          </div>

          <button className="secondary small" onClick={onRefresh}>
            Refresh now
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Why a screenshot of this is useless</h2>
        <ul className="muted" style={{ marginTop: 0, paddingLeft: '1.1rem' }}>
          <li>
            It expires {Math.round(total / 1000)} seconds after it was issued, and is replaced before
            that.
          </li>
          <li>It works exactly once — the server discards the nonce on the first successful scan.</li>
          <li>
            It is signed by this device&apos;s private key, which nobody else holds and which cannot
            be copied off this device.
          </li>
        </ul>

        <div className="row" style={{ marginTop: '0.75rem' }}>
          <button className="secondary small" onClick={checkExtractability}>
            Verify the private key cannot be exported
          </button>
          <button className="danger small" onClick={onReset}>
            Reset this device
          </button>
        </div>

        {proof !== null && (
          <div className={`alert ${proof ? 'success' : 'error'}`} style={{ marginTop: '0.75rem' }}>
            {proof
              ? 'Confirmed — crypto.subtle.exportKey() refused to export the private key. It cannot leave this device.'
              : 'Warning — the private key reported as extractable. That should never happen.'}
          </div>
        )}

        <details style={{ marginTop: '0.75rem' }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>
            Inspect the signed payload
          </summary>
          <pre className="mono muted" style={{ overflowX: 'auto', fontSize: '0.75rem' }}>
            {JSON.stringify(JSON.parse(challenge.payload), null, 2)}
          </pre>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Signed message: <code>{challenge.message}</code>
          </p>
        </details>
      </div>
    </>
  );
}
