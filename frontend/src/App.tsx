import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { DriversPage } from './pages/DriversPage';
import { ReaderPage } from './pages/ReaderPage';
import { SyncPage } from './pages/SyncPage';
import { AdminPage } from './pages/AdminPage';
import { DriverConfigPage } from './pages/DriverConfigPage';
import { CompareDriversPage } from './pages/CompareDriversPage';
import { SettlementPage } from './pages/SettlementPage';
import { VehiclesPage } from './pages/VehiclesPage';
import { AnalysisPage } from './pages/AnalysisPage';
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

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { loggedIn, isAdmin } = useAuth();
  if (loggedIn === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (!loggedIn) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
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
      <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
      <Route path="/config" element={<AdminRoute><DriverConfigPage /></AdminRoute>} />
      <Route path="/compare" element={<AdminRoute><CompareDriversPage /></AdminRoute>} />
      <Route path="/settlement" element={<AdminRoute><SettlementPage /></AdminRoute>} />
      <Route path="/vehicles" element={<AdminRoute><VehiclesPage /></AdminRoute>} />
      <Route path="/analysis" element={<ProtectedRoute><AnalysisPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
