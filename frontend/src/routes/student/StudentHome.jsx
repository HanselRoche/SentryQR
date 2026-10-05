import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ChevronDown, Fingerprint, Maximize2, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
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
import PageHeader from '../../components/PageHeader.jsx';
import Card from '../../components/Card.jsx';
import Alert from '../../components/Alert.jsx';
import Avatar from '../../components/Avatar.jsx';
import Badge from '../../components/Badge.jsx';

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

  if (error && !profile) return <Alert tone="error">{error}</Alert>;
  if (!profile) return <p className="muted">Loading…</p>;

  // Enrolment is needed when this browser holds no key, or when the server's
  // active key is a different one — which happens after enrolling elsewhere or
  // after an admin revokes this key.
  const serverKid = profile.activeKey?.kid ?? null;
  const needsEnrolment = !deviceKey || !serverKid || deviceKey.kid !== serverKid;

  return (
    <>
      <PageHeader
        title="My entry pass"
        subtitle="A fresh signature, valid for 45 seconds and accepted exactly once."
        actions={
          !needsEnrolment && (
            <button className="secondary" onClick={refresh}>
              <RefreshCw size={15} />
              Refresh now
            </button>
          )
        }
      />

      <Card>
        <div className="identity-card">
          <Avatar name={profile.user.fullName} />
          <div>
            <h2 className="card-title" style={{ marginBottom: '0.15rem' }}>
              {profile.user.fullName}
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              {profile.student?.rollNo} · Room {profile.student?.roomNo} · Block{' '}
              {profile.student?.hostelBlock}
            </p>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            {serverKid ? (
              <Badge tone="grant" className="mono">
                {serverKid}
              </Badge>
            ) : (
              <Badge tone="warn">no device key</Badge>
            )}
          </div>
        </div>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}

      {needsEnrolment ? (
        <EnrolmentCard
          busy={busy}
          onEnrol={enrolDevice}
          hasLocalKey={Boolean(deviceKey)}
          serverHasKey={Boolean(serverKid)}
          mismatched={Boolean(deviceKey && serverKid && deviceKey.kid !== serverKid)}
        />
      ) : (
        <QrCard challenge={challenge} deviceKey={deviceKey} onReset={resetDevice} />
      )}
    </>
  );
}

function EnrolmentCard({ busy, onEnrol, hasLocalKey, serverHasKey, mismatched }) {
  return (
    <Card title="Enrol this device">
      {mismatched && (
        <Alert tone="error">
          The key stored in this browser is no longer the one registered on the server. It was
          either revoked by an administrator, or superseded when you enrolled a different device.
          Enrol again to continue.
        </Alert>
      )}
      {!hasLocalKey && serverHasKey && !mismatched && (
        <Alert tone="info">
          Your account has a registered key, but it belongs to a different browser or device. Keys
          cannot be copied between devices — that is precisely what stops credential sharing. Enrol
          this device to give it its own key.
        </Alert>
      )}

      <p className="muted">
        This generates an ECDSA P-256 keypair inside your browser. The private half is marked{' '}
        <strong>non-extractable</strong>: it lives as an opaque handle in IndexedDB and cannot be
        exported, copied, screenshotted, or sent anywhere — not even by this page&apos;s own code.
        Only the public half reaches the server.
      </p>

      <button onClick={onEnrol} disabled={busy}>
        <Fingerprint size={16} />
        {busy ? 'Generating keypair…' : 'Generate key and enrol'}
      </button>
    </Card>
  );
}

function QrCard({ challenge, deviceKey, onReset }) {
  const canvasRef = useRef(null);
  const [remaining, setRemaining] = useState(0);
  const [proof, setProof] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Esc closes the fullscreen view.
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // Draw whenever the payload changes.
  useEffect(() => {
    if (!challenge || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, challenge.payload, {
      width: 560,
      margin: 1,
      errorCorrectionLevel: 'L',
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
    <div className="grid-2 qr-layout">
      <Card>
        <div className="qr-stage">
          <div
            className={`qr-frame${expired ? ' stale' : ''}${fullscreen ? ' fullscreen' : ''}`}
            onClick={fullscreen ? () => setFullscreen(false) : undefined}
          >
            <canvas ref={canvasRef} />
            {fullscreen && (
              <div className="qr-fullscreen-hint">
                {expired ? 'Expired — refreshing' : `Valid for ${seconds}s`} · tap or press Esc to close
              </div>
            )}
          </div>

          <button className="secondary small" onClick={() => setFullscreen(true)}>
            <Maximize2 size={14} />
            Full screen
          </button>

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
        </div>
      </Card>

      <Card
        title="Why a screenshot of this is useless"
        subtitle="Three independent properties, each enough on its own to defeat a copy."
      >
        <ul className="muted reasons">
          <li>
            It expires {Math.round(total / 1000)} seconds after it was issued, and is replaced
            before that.
          </li>
          <li>It works exactly once — the server discards the nonce on the first successful scan.</li>
          <li>
            It is signed by this device&apos;s private key, which nobody else holds and which cannot
            be copied off this device.
          </li>
        </ul>

        <div className="row" style={{ marginTop: '1.25rem' }}>
          <button className="secondary small" onClick={checkExtractability}>
            <ShieldCheck size={14} />
            Verify the private key cannot be exported
          </button>
          <button className="danger small" onClick={onReset}>
            <RotateCcw size={14} />
            Reset this device
          </button>
        </div>

        {proof !== null && (
          <div style={{ marginTop: '1rem' }}>
            <Alert tone={proof ? 'success' : 'error'}>
              {proof
                ? 'Confirmed — crypto.subtle.exportKey() refused to export the private key. It cannot leave this device.'
                : 'Warning — the private key reported as extractable. That should never happen.'}
            </Alert>
          </div>
        )}

        <details style={{ marginTop: '1rem' }}>
          <summary>
            <ChevronDown size={14} />
            Inspect the signed payload
          </summary>
          <pre className="mono payload-pre">
            {JSON.stringify(JSON.parse(challenge.payload), null, 2)}
          </pre>
          <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
            Signed message: <code>{challenge.message}</code>
          </p>
        </details>
      </Card>
    </div>
  );
}
