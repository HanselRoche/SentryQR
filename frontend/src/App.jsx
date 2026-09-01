import { Navigate, Route, Routes } from 'react-router-dom';
import { homeFor, useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './routes/Login.jsx';
import StudentHome from './routes/student/StudentHome.jsx';
import StudentHistory from './routes/student/StudentHistory.jsx';
import GuardScanner from './routes/guard/GuardScanner.jsx';
import GuardOverride from './routes/guard/GuardOverride.jsx';
import AdminStudents from './routes/admin/AdminStudents.jsx';
import AdminKeys from './routes/admin/AdminKeys.jsx';
import AdminAudit from './routes/admin/AdminAudit.jsx';
import AdminOverrides from './routes/admin/AdminOverrides.jsx';

/** Client-side gate. Convenience only — the server enforces every role check. */
function Protected({ role, children }) {
  const { user, loading } = useAuth();

  if (loading) return <div className="login-wrap muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={homeFor(user.role)} replace />;

  return <Layout>{children}</Layout>;
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="login-wrap muted">Loading…</div>;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/student" element={<Protected role="student"><StudentHome /></Protected>} />
      <Route path="/student/history" element={<Protected role="student"><StudentHistory /></Protected>} />

      <Route path="/guard" element={<Protected role="guard"><GuardScanner /></Protected>} />
      <Route path="/guard/override" element={<Protected role="guard"><GuardOverride /></Protected>} />

      <Route path="/admin" element={<Protected role="admin"><AdminStudents /></Protected>} />
      <Route path="/admin/keys" element={<Protected role="admin"><AdminKeys /></Protected>} />
      <Route path="/admin/overrides" element={<Protected role="admin"><AdminOverrides /></Protected>} />
      <Route path="/admin/audit" element={<Protected role="admin"><AdminAudit /></Protected>} />

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
