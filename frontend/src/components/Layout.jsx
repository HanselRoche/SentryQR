import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

const NAV = {
  student: [
    { to: '/student', label: 'My QR', end: true },
    { to: '/student/history', label: 'Entry history' },
  ],
  guard: [
    { to: '/guard', label: 'Scanner', end: true },
    { to: '/guard/override', label: 'Manual override' },
  ],
  admin: [
    { to: '/admin', label: 'Students', end: true },
    { to: '/admin/keys', label: 'Keys' },
    { to: '/admin/overrides', label: 'Overrides' },
    { to: '/admin/audit', label: 'Audit log' },
  ],
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          Sentry<span>QR</span>
        </div>

        <nav>
          {(NAV[user.role] ?? []).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="spacer" />

        <span className="muted">
          {user.fullName} · <span className="badge dim">{user.role}</span>
        </span>
        <button className="secondary small" onClick={handleLogout}>
          Log out
        </button>
      </header>

      <main>{children}</main>
    </div>
  );
}
