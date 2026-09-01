/**
 * Plain-language labels for the machine reason codes.
 *
 * The codes themselves are still shown alongside these on the guard and admin
 * screens — during a demo the code is what maps back to the threat model, while
 * the sentence is what a person can act on.
 */
const REASONS = {
  OK: 'Verified',
  MALFORMED_PAYLOAD: 'QR content was not a valid SentryQR payload',
  UNSUPPORTED_VERSION: 'QR uses an unsupported payload version',
  UNKNOWN_NONCE: 'Challenge not issued by this server (fabricated QR)',
  NONCE_REUSED: 'This QR was already used — replay attempt',
  CHALLENGE_EXPIRED: 'QR has expired — likely a screenshot',
  IDENTITY_MISMATCH: 'QR was issued to a different student — impersonation attempt',
  STUDENT_INACTIVE: 'Student account is suspended',
  UNREGISTERED_STUDENT: 'Student has no registered device key',
  KEY_REVOKED: 'Student key has been revoked',
  INVALID_SIGNATURE: 'Signature did not verify — payload was tampered with or forged',
  MANUAL_OVERRIDE: 'Manual override approved by admin',
};

export const reasonLabel = (code) => REASONS[code] ?? code;

const EVENTS = {
  LOGIN_SUCCESS: 'Login',
  LOGIN_FAILURE: 'Failed login',
  LOGOUT: 'Logout',
  KEY_REGISTERED: 'Key enrolled',
  KEY_REVOKED: 'Key revoked',
  CHALLENGE_ISSUED: 'Challenge issued',
  VERIFY: 'Gate verification',
  OVERRIDE_REQUESTED: 'Override requested',
  OVERRIDE_DECIDED: 'Override decided',
  USER_CREATED: 'User created',
  USER_UPDATED: 'User updated',
  RATE_LIMITED: 'Rate limited',
};

export const eventLabel = (type) => EVENTS[type] ?? type;

export const EVENT_TYPES = Object.keys(EVENTS);

export function formatTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatRelative(ms) {
  if (!ms) return 'never';
  const delta = Date.now() - ms;
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
