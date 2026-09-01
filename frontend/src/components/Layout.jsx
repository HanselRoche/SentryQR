import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Bell,
  History,
  KeyRound,
  LogOut,
  QrCode,
  ScanLine,
  ScrollText,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Avatar from './Avatar.jsx';

const NAV = {
  student: [
    { to: '/student', label: 'My QR', end: true, icon: QrCode },
    { to: '/student/history', label: 'Entry history', icon: History },
  ],
  guard: [
    { to: '/guard', label: 'Scanner', end: true, icon: ScanLine },
    { to: '/guard/override', label: 'Manual override', icon: ShieldAlert },
  ],
  admin: [
    { to: '/admin', label: 'Students', end: true, icon: Users },
    { to: '/admin/keys', label: 'Keys', icon: KeyRound },
    { to: '/admin/overrides', label: 'Overrides', icon: ShieldAlert },
    { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
  ],
};

/* -------------------------------------------------------------------------
   Page search
   The header search box belongs to the shell, but only the page knows what it
   filters — there is no server-side search endpoint. A page opts in with
   usePageSearch(); pages that don't call it get no search box rather than a
   dead one.
   ------------------------------------------------------------------------- */

const SearchContext = createContext(null);

export function usePageSearch(placeholder = 'Search') {
  const context = useContext(SearchContext);
  const register = context?.register;

  useEffect(() => register?.(placeholder), [register, placeholder]);

  return context?.query ?? '';
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [placeholder, setPlaceholder] = useState(null);

  const register = useCallback((text) => {
    setPlaceholder(text);
    setQuery('');
    return () => {
      setPlaceholder(null);
      setQuery('');
    };
  }, []);

  const search = useMemo(() => ({ query, register }), [query, register]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const items = NAV[user.role] ?? [];

  return (
    <SearchContext.Provider value={search}>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">
              <ShieldCheck size={19} />
            </span>
            <span className="brand-text">
              Sentry<span>QR</span>
            </span>
          </div>

          <nav className="sidebar-nav">
            <div className="nav-group-label">Menu</div>
            {items.map(({ to, label, end, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                <Icon size={17} />
                {label}
              </NavLink>
            ))}

            <div className="nav-group-label">General</div>
            <button type="button" className="nav-item" onClick={handleLogout}>
              <LogOut size={17} />
              Log out
            </button>
          </nav>

          <div className="sidebar-user">
            <Avatar name={user.fullName} />
            <div className="who">
              <strong>{user.fullName}</strong>
              <small>{user.role}</small>
            </div>
          </div>
        </aside>

        <div className="app-main">
          <div className="topstrip">
            {placeholder ? (
              <div className="search-field">
                <Search size={16} />
                <input
                  type="search"
                  value={query}
                  placeholder={placeholder}
                  aria-label={placeholder}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            ) : (
              <div className="spacer" />
            )}

            <div className="spacer" />

            {user.role === 'admin' && <PendingOverridesBell />}

            <div className="user-chip">
              <Avatar name={user.fullName} />
              <div className="who">
                <strong>{user.fullName}</strong>
                <small>{user.role}</small>
              </div>
            </div>
          </div>

          <main>{children}</main>
        </div>
      </div>
    </SearchContext.Provider>
  );
}

/**
 * A real notification, not an ornament: pending overrides are the only thing in
 * this system that actually waits on an admin.
 */
function PendingOverridesBell() {
  const [pending, setPending] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api
      .listOverrides('pending')
      .then((data) => {
        if (!cancelled) setPending(data.overrides.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <button
      type="button"
      className="icon-btn"
      style={{ position: 'relative' }}
      title={pending ? `${pending} override(s) awaiting a decision` : 'No pending overrides'}
      aria-label={pending ? `${pending} overrides awaiting a decision` : 'No pending overrides'}
      onClick={() => navigate('/admin/overrides')}
    >
      <Bell size={17} />
      {pending > 0 && (
        <span
          style={{
            position: 'absolute',
            top: 5,
            right: 5,
            minWidth: 8,
            height: 8,
            borderRadius: 999,
            background: 'var(--deny)',
          }}
        />
      )}
    </button>
  );
}
