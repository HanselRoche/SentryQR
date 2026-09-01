/**
 * Thin API client. `credentials: 'include'` on every call so the HttpOnly
 * session cookie rides along — the app itself can never read that cookie, which
 * is the point.
 */

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, 'BAD_RESPONSE', 'Server returned a non-JSON response');
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? res.statusText);
  }
  return data;
}

export const api = {
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  logout: () => request('POST', '/api/auth/logout'),
  me: () => request('GET', '/api/auth/me'),

  studentProfile: () => request('GET', '/api/students/me'),
  registerKey: (jwk) => request('POST', '/api/students/keys', { jwk }),
  myEntries: (limit = 50) => request('GET', `/api/students/me/entries?limit=${limit}`),
  requestChallenge: () => request('POST', '/api/challenge'),

  verify: (payload) => request('POST', '/api/verify', { payload }),
  requestOverride: (rollNo, reason) => request('POST', '/api/overrides', { rollNo, reason }),

  listOverrides: (status = 'pending') => request('GET', `/api/overrides?status=${status}`),
  decideOverride: (id, approve, note) =>
    request('POST', `/api/overrides/${id}/decision`, { approve, note }),

  listUsers: (role) => request('GET', `/api/admin/users${role ? `?role=${role}` : ''}`),
  createUser: (payload) => request('POST', '/api/admin/users', payload),
  setUserActive: (id, active) => request('PATCH', `/api/admin/users/${id}`, { active }),

  listKeys: (includeRevoked = false) =>
    request('GET', `/api/admin/keys?includeRevoked=${includeRevoked}`),
  revokeKey: (id) => request('POST', `/api/admin/keys/${id}/revoke`),

  auditLog: (params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== ''),
    );
    return request('GET', `/api/admin/audit?${query}`);
  },
  entries: (params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== ''),
    );
    return request('GET', `/api/admin/entries?${query}`);
  },
};
