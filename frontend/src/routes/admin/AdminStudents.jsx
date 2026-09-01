import { useEffect, useMemo, useState } from 'react';
import { KeyRound, ShieldOff, UserPlus, Users } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatRelative } from '../../lib/format.js';
import PageHeader from '../../components/PageHeader.jsx';
import Card from '../../components/Card.jsx';
import Alert from '../../components/Alert.jsx';
import Avatar from '../../components/Avatar.jsx';
import Badge from '../../components/Badge.jsx';
import DataTable from '../../components/DataTable.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import StatTile, { StatGrid } from '../../components/StatTile.jsx';
import { usePageSearch } from '../../components/Layout.jsx';

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
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const query = usePageSearch('Search by name, username or roll number');

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
      setShowForm(false);
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

  const students = (users ?? []).filter((user) => user.role === 'student');
  const stats = {
    accounts: users?.length ?? 0,
    enrolled: students.filter((user) => user.activeKey).length,
    notEnrolled: students.filter((user) => !user.activeKey).length,
    suspended: (users ?? []).filter((user) => !user.active).length,
  };

  const filtered = useMemo(() => {
    if (!users) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) =>
      [user.fullName, user.username, user.student?.rollNo, user.student?.roomNo]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [users, query]);

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (user) => (
        <div className="cell-person">
          <Avatar name={user.fullName} size="sm" />
          <div className="who">
            <strong>{user.fullName}</strong>
            <small className="mono">{user.username}</small>
          </div>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (user) => <Badge>{user.role}</Badge> },
    {
      key: 'rollRoom',
      header: 'Roll / Room',
      render: (user) => (user.student ? `${user.student.rollNo} · ${user.student.roomNo}` : '—'),
    },
    {
      key: 'deviceKey',
      header: 'Device key',
      render: (user) => {
        if (user.role !== 'student') return '—';
        return user.activeKey ? (
          <Badge tone="grant" className="mono">
            {user.activeKey.kid}
          </Badge>
        ) : (
          <Badge tone="warn">not enrolled</Badge>
        );
      },
    },
    {
      key: 'lastEntryAt',
      header: 'Last entry',
      className: 'muted',
      render: (user) => formatRelative(user.lastEntryAt),
    },
    {
      key: 'status',
      header: 'Status',
      render: (user) => (
        <Badge tone={user.active ? 'grant' : 'deny'}>{user.active ? 'active' : 'suspended'}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (user) =>
        user.role !== 'admin' && (
          <button
            className={user.active ? 'danger small' : 'secondary small'}
            onClick={() => toggleActive(user)}
          >
            {user.active ? 'Suspend' : 'Reinstate'}
          </button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Students and guards. New students hold no device key until they enrol one themselves."
        actions={
          <button onClick={() => setShowForm((open) => !open)}>
            <UserPlus size={15} />
            {showForm ? 'Close' : 'Add account'}
          </button>
        }
      />

      <StatGrid>
        <StatTile
          tone="hero"
          label="Total accounts"
          value={stats.accounts}
          icon={<Users size={15} />}
          hint="Students, guards and admins"
        />
        <StatTile
          label="Devices enrolled"
          value={stats.enrolled}
          icon={<KeyRound size={15} />}
          hint="Students with an active key"
        />
        <StatTile label="Awaiting enrolment" value={stats.notEnrolled} hint="Cannot pass the gate yet" />
        <StatTile
          label="Suspended"
          value={stats.suspended}
          icon={<ShieldOff size={15} />}
          hint="Sessions revoked"
        />
      </StatGrid>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {showForm && (
        <Card
          title="Register an account"
          subtitle="New students have no device key until they log in and enrol a device themselves — the server never generates or holds a private key."
        >
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
          </form>
        </Card>
      )}

      <Card
        title="All accounts"
        action={<span className="muted">{filtered?.length ?? 0} shown</span>}
      >
        <DataTable
          columns={columns}
          rows={filtered}
          loading={!users}
          empty={
            <EmptyState icon={Users} title="No matching accounts">
              {query ? 'Try a different search term.' : 'Create the first account to get started.'}
            </EmptyState>
          }
        />
      </Card>
    </>
  );
}
