import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { DriversPage } from './pages/DriversPage';
import { ReaderPage } from './pages/ReaderPage';
import { SyncPage } from './pages/SyncPage';
import { Spinner } from './components/Spinner';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { loggedIn } = useAuth();
  if (loggedIn === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (!loggedIn) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export function App() {
  const { loggedIn } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={loggedIn ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/drivers" element={<ProtectedRoute><DriversPage /></ProtectedRoute>} />
      <Route path="/reader" element={<ProtectedRoute><ReaderPage /></ProtectedRoute>} />
      <Route path="/sync" element={<ProtectedRoute><SyncPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
