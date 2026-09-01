import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { formatRelative } from '../../lib/format.js';

const BLANK = {
  role: 'student',
  username: '',
  password: '',
  fullName: '',
  rollNo: '',
  roomNo: '',
  hostelBlock: '',
};

export default function AdminStudents() {
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .listUsers()
      .then((data) => setUsers(data.users))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload =
        form.role === 'student'
          ? form
          : { role: form.role, username: form.username, password: form.password, fullName: form.fullName };

      const data = await api.createUser(payload);
      setNotice(`Created ${data.user.role} "${data.user.username}".`);
      setForm(BLANK);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (user) => {
    try {
      await api.setUserActive(user.id, !user.active);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <div className="card">
        <h2>Register an account</h2>
        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}

        <form onSubmit={submit}>
          <div className="row">
            <div className="field">
              <label htmlFor="role">Role</label>
              <select id="role" value={form.role} onChange={update('role')}>
                <option value="student">Student</option>
                <option value="guard">Guard</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="fullName">Full name</label>
              <input id="fullName" value={form.fullName} onChange={update('fullName')} required />
            </div>
            <div className="field">
              <label htmlFor="username">Username</label>
              <input id="username" value={form.username} onChange={update('username')} required />
            </div>
            <div className="field">
              <label htmlFor="password">Password (min 8)</label>
              <input
                id="password"
                type="password"
                value={form.password}
                onChange={update('password')}
                minLength={8}
                required
              />
            </div>
          </div>

          {form.role === 'student' && (
            <div className="row">
              <div className="field">
                <label htmlFor="rollNo">Roll number</label>
                <input id="rollNo" value={form.rollNo} onChange={update('rollNo')} required />
              </div>
              <div className="field">
                <label htmlFor="roomNo">Room</label>
                <input id="roomNo" value={form.roomNo} onChange={update('roomNo')} required />
              </div>
              <div className="field">
                <label htmlFor="hostelBlock">Block</label>
                <input
                  id="hostelBlock"
                  value={form.hostelBlock}
                  onChange={update('hostelBlock')}
                  required
                />
              </div>
            </div>
          )}

          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <p className="muted" style={{ marginBottom: 0 }}>
            New students have no device key until they log in and enrol a device themselves — the
            server never generates or holds a private key.
          </p>
        </form>
      </div>

      <div className="card">
        <h2>Accounts</h2>
        {!users ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Roll / Room</th>
                  <th>Device key</th>
                  <th>Last entry</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      {user.fullName}
                      <div className="muted mono">{user.username}</div>
                    </td>
                    <td>
                      <span className="badge dim">{user.role}</span>
                    </td>
                    <td>
                      {user.student ? `${user.student.rollNo} · ${user.student.roomNo}` : '—'}
                    </td>
                    <td>
                      {user.role !== 'student' ? (
                        '—'
                      ) : user.activeKey ? (
                        <span className="badge grant mono">{user.activeKey.kid}</span>
                      ) : (
                        <span className="badge warn">not enrolled</span>
                      )}
                    </td>
                    <td className="muted">{formatRelative(user.lastEntryAt)}</td>
                    <td>
                      <span className={`badge ${user.active ? 'grant' : 'deny'}`}>
                        {user.active ? 'active' : 'suspended'}
                      </span>
                    </td>
                    <td>
                      {user.role !== 'admin' && (
                        <button
                          className={user.active ? 'danger small' : 'secondary small'}
                          onClick={() => toggleActive(user)}
                        >
                          {user.active ? 'Suspend' : 'Reinstate'}
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
    </>
  );
}
