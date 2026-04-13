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
const TollCollectPage = lazy(() => import('./pages/TollCollectPage').then(m => ({ default: m.TollCollectPage })));
const SamsaraKmPage = lazy(() => import('./pages/SamsaraKmPage').then(m => ({ default: m.SamsaraKmPage })));
const NightSimulatorPage = lazy(() => import('./pages/NightSimulatorPage').then(m => ({ default: m.NightSimulatorPage })));
const PayrollPage = lazy(() => import('./pages/PayrollPage').then(m => ({ default: m.PayrollPage })));
const PayrollAnalysisPage = lazy(() => import('./pages/PayrollAnalysisPage').then(m => ({ default: m.PayrollAnalysisPage })));
const StundenzettelPage = lazy(() => import('./pages/StundenzettelPage').then(m => ({ default: m.StundenzettelPage })));
const BulkGridPage = lazy(() => import('./pages/BulkGridPage').then(m => ({ default: m.BulkGridPage })));


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

/** Route for admin + dispatcher roles */
function DispatcherRoute({ children }: { children: React.ReactNode }) {
  const { loggedIn, isDispatcher } = useAuth();
  if (loggedIn === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (!loggedIn) return <Navigate to="/login" replace />;
  if (!isDispatcher) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

/** Route that checks a specific permission */
function PermissionRoute({ children, permission }: { children: React.ReactNode; permission: string }) {
  const { loggedIn, hasPermission } = useAuth();
  if (loggedIn === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (!loggedIn) return <Navigate to="/login" replace />;
  if (!hasPermission(permission)) return <Navigate to="/" replace />;
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
          <Route path="/drivers" element={<PermissionRoute permission="drivers"><DriversPage /></PermissionRoute>} />
          <Route path="/reader" element={<ProtectedRoute><ReaderPage /></ProtectedRoute>} />
          <Route path="/sync" element={<PermissionRoute permission="sync"><SyncPage /></PermissionRoute>} />
          <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
          <Route path="/config" element={<AdminRoute><DriverConfigPage /></AdminRoute>} />
          <Route path="/compare" element={<DispatcherRoute><CompareDriversPage /></DispatcherRoute>} />
          <Route path="/settlement" element={<DispatcherRoute><SettlementPage /></DispatcherRoute>} />
          <Route path="/payroll" element={<DispatcherRoute><PayrollPage /></DispatcherRoute>} />
          <Route path="/payroll/:card" element={<DispatcherRoute><PayrollAnalysisPage /></DispatcherRoute>} />
          <Route path="/stundenzettel" element={<DispatcherRoute><StundenzettelPage /></DispatcherRoute>} />
          <Route path="/bulk-grid" element={<DispatcherRoute><BulkGridPage /></DispatcherRoute>} />
          <Route path="/vehicles" element={<DispatcherRoute><VehiclesPage /></DispatcherRoute>} />
          <Route path="/driver-km" element={<DispatcherRoute><DriverKmPage /></DispatcherRoute>} />
          <Route path="/toll" element={<DispatcherRoute><TollCollectPage /></DispatcherRoute>} />
          <Route path="/samsara-km" element={<DispatcherRoute><SamsaraKmPage /></DispatcherRoute>} />
          <Route path="/night-sim" element={<AdminRoute><NightSimulatorPage /></AdminRoute>} />
          <Route path="/analysis" element={<ProtectedRoute><AnalysisPage /></ProtectedRoute>} />
          <Route path="/verstosse" element={<PermissionRoute permission="verstosse"><VerstossePage /></PermissionRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
