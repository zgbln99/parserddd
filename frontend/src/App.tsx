import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { Spinner } from './components/Spinner';
import { GlobalSearch } from './components/GlobalSearch';
import { OfflineBanner } from './components/OfflineBanner';

// Lazy-loaded pages for code splitting
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const DriversPage = lazy(() => import('./pages/DriversPage').then(m => ({ default: m.DriversPage })));
const ReaderPage = lazy(() => import('./pages/ReaderPage').then(m => ({ default: m.ReaderPage })));
const SyncPage = lazy(() => import('./pages/SyncPage').then(m => ({ default: m.SyncPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const DriverConfigPage = lazy(() => import('./pages/DriverConfigPage').then(m => ({ default: m.DriverConfigPage })));
const CompareDriversPage = lazy(() => import('./pages/CompareDriversPage').then(m => ({ default: m.CompareDriversPage })));
const SettlementPage = lazy(() => import('./pages/SettlementPage').then(m => ({ default: m.SettlementPage })));
const VehiclesPage = lazy(() => import('./pages/VehiclesPage').then(m => ({ default: m.VehiclesPage })));
const AnalysisPage = lazy(() => import('./pages/AnalysisPage').then(m => ({ default: m.AnalysisPage })));
const VerstossePage = lazy(() => import('./pages/VerstossePage').then(m => ({ default: m.VerstossePage })));
const DriverKmPage = lazy(() => import('./pages/DriverKmPage').then(m => ({ default: m.DriverKmPage })));


function PageFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <Spinner size="lg" />
    </div>
  );
}

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
    <>
      <OfflineBanner />
      <GlobalSearch />
      <Suspense fallback={<PageFallback />}>
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
          <Route path="/driver-km" element={<AdminRoute><DriverKmPage /></AdminRoute>} />
          <Route path="/analysis" element={<ProtectedRoute><AnalysisPage /></ProtectedRoute>} />
          <Route path="/verstosse" element={<ProtectedRoute><VerstossePage /></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
