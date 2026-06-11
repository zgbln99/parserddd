import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { LandingPage } from './pages/LandingPage';
import { SignPage } from './pages/SignPage';
import { DriverProfilePage } from './pages/DriverProfilePage';
import { Spinner } from './components/Spinner';
import { GlobalSearch } from './components/GlobalSearch';
import { OfflineBanner } from './components/OfflineBanner';
import { Changelog } from './components/Changelog';
import { InstallPrompt } from './components/InstallPrompt';
import { NewFilesNotification } from './components/Notifications';

// Lazy-loaded pages
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const DriversPage = lazy(() => import('./pages/DriversPage').then(m => ({ default: m.DriversPage })));
const ReaderPage = lazy(() => import('./pages/ReaderPage').then(m => ({ default: m.ReaderPage })));
const SyncPage = lazy(() => import('./pages/SyncPage').then(m => ({ default: m.SyncPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const DriverConfigPage = lazy(() => import('./pages/DriverConfigPage').then(m => ({ default: m.DriverConfigPage })));
const VehiclesPage = lazy(() => import('./pages/VehiclesPage').then(m => ({ default: m.VehiclesPage })));
const AnalysisPage = lazy(() => import('./pages/AnalysisPage').then(m => ({ default: m.AnalysisPage })));
const DriverKmPage = lazy(() => import('./pages/DriverKmPage').then(m => ({ default: m.DriverKmPage })));
const TollCollectPage = lazy(() => import('./pages/TollCollectPage').then(m => ({ default: m.TollCollectPage })));
const SamsaraKmPage = lazy(() => import('./pages/SamsaraKmPage').then(m => ({ default: m.SamsaraKmPage })));
const OdometerPage = lazy(() => import('./pages/OdometerPage').then(m => ({ default: m.OdometerPage })));
const FleetMapPage = lazy(() => import('./pages/FleetMapPage').then(m => ({ default: m.FleetMapPage })));
const FuelCardsPage = lazy(() => import('./pages/FuelCardsPage').then(m => ({ default: m.FuelCardsPage })));
const SafetyEventsPage = lazy(() => import('./pages/SafetyEventsPage').then(m => ({ default: m.SafetyEventsPage })));
const DiagnosticsPage = lazy(() => import('./pages/DiagnosticsPage').then(m => ({ default: m.DiagnosticsPage })));
const PayrollPage = lazy(() => import('./pages/PayrollPage').then(m => ({ default: m.PayrollPage })));
const PayrollAnalysisPage = lazy(() => import('./pages/PayrollAnalysisPage').then(m => ({ default: m.PayrollAnalysisPage })));
const StundenzettelPage = lazy(() => import('./pages/StundenzettelPage').then(m => ({ default: m.StundenzettelPage })));
const BulkGridPage = lazy(() => import('./pages/BulkGridPage').then(m => ({ default: m.BulkGridPage })));
const ArbeitszeitberichtPage = lazy(() => import('./pages/ArbeitszeitberichtPage').then(m => ({ default: m.ArbeitszeitberichtPage })));
const ComplianceMonthlyPage = lazy(() => import('./pages/ComplianceMonthlyPage').then(m => ({ default: m.ComplianceMonthlyPage })));
const CompliancePage = lazy(() => import('./pages/CompliancePage'));


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
  // Anyone who isn't logged in lands on the public marketing site rather
  // than seeing the dispatcher login as the front door.
  if (!loggedIn) return <LandingPage />;
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
  const { loggedIn, isAdmin } = useAuth();
  const location = useLocation();

  // Public, token-bearer pages (driver profile, signing) must never show the
  // internal app chrome — even when an admin opens them while logged in.
  const isPublicPage =
    location.pathname.startsWith('/profil/') || location.pathname.startsWith('/sign/');

  return (
    <>
      {!isPublicPage && (
        <>
          <OfflineBanner />
          <GlobalSearch />
          {loggedIn && isAdmin && <Changelog />}
          {loggedIn && <InstallPrompt />}
          {loggedIn && <NewFilesNotification />}
        </>
      )}
      <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* Public driver-signing flow — no auth, token-bearer */}
          <Route path="/sign/:token" element={<SignPage />} />
          {/* Public driver profile — no auth, token-bearer + password */}
          <Route path="/profil/:token" element={<DriverProfilePage />} />
          <Route path="/login" element={loggedIn ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/drivers" element={<PermissionRoute permission="drivers"><DriversPage /></PermissionRoute>} />
          <Route path="/reader" element={<ProtectedRoute><ReaderPage /></ProtectedRoute>} />
          <Route path="/sync" element={<PermissionRoute permission="sync"><SyncPage /></PermissionRoute>} />
          <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
          <Route path="/config" element={<AdminRoute><DriverConfigPage /></AdminRoute>} />
          <Route path="/payroll" element={<PermissionRoute permission="settlement"><PayrollPage /></PermissionRoute>} />
          <Route path="/payroll/:card" element={<PermissionRoute permission="settlement"><PayrollAnalysisPage /></PermissionRoute>} />
          <Route path="/stundenzettel" element={<PermissionRoute permission="settlement"><StundenzettelPage /></PermissionRoute>} />
          <Route path="/bulk-grid" element={<PermissionRoute permission="settlement"><BulkGridPage /></PermissionRoute>} />
          <Route path="/vehicles" element={<PermissionRoute permission="vehicles"><VehiclesPage /></PermissionRoute>} />
          <Route path="/driver-km" element={<PermissionRoute permission="driver_km"><DriverKmPage /></PermissionRoute>} />
          <Route path="/toll" element={<PermissionRoute permission="toll"><TollCollectPage /></PermissionRoute>} />
          <Route path="/samsara-km" element={<PermissionRoute permission="samsara_km"><SamsaraKmPage /></PermissionRoute>} />
          <Route path="/odometer" element={<PermissionRoute permission="vehicles"><OdometerPage /></PermissionRoute>} />
          <Route path="/map" element={<PermissionRoute permission="vehicles"><FleetMapPage /></PermissionRoute>} />
          <Route path="/fuel-cards" element={<PermissionRoute permission="vehicles"><FuelCardsPage /></PermissionRoute>} />
          <Route path="/safety" element={<PermissionRoute permission="vehicles"><SafetyEventsPage /></PermissionRoute>} />
          <Route path="/diagnostics" element={<PermissionRoute permission="vehicles"><DiagnosticsPage /></PermissionRoute>} />
          <Route path="/analysis" element={<ProtectedRoute><AnalysisPage /></ProtectedRoute>} />
          <Route path="/arbeitszeitbericht" element={<PermissionRoute permission="settlement"><ArbeitszeitberichtPage /></PermissionRoute>} />
          <Route path="/compliance" element={<PermissionRoute permission="settlement"><CompliancePage /></PermissionRoute>} />
          <Route path="/compliance-monthly" element={<PermissionRoute permission="settlement"><ComplianceMonthlyPage /></PermissionRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
