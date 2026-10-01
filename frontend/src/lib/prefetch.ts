/**
 * Route prefetching — warms the lazy chunk for a page while the user is
 * still hovering the nav link, so the actual navigation feels instant.
 *
 * Vite/Rollup dedupes dynamic imports of the same module, so these importers
 * resolve to the exact same chunks that App.tsx's `lazy()` calls use.
 */

const importers: Record<string, () => Promise<unknown>> = {
  '/': () => import('../pages/DashboardPage'),
  '/drivers': () => import('../pages/DriversPage'),
  '/reader': () => import('../pages/ReaderPage'),
  '/sync': () => import('../pages/SyncPage'),
  '/admin': () => import('../pages/AdminPage'),
  '/config': () => import('../pages/DriverConfigPage'),
  '/vehicles': () => import('../pages/VehiclesPage'),
  '/analysis': () => import('../pages/AnalysisPage'),
  '/toll': () => import('../pages/TollCollectPage'),
  '/odometer': () => import('../pages/OdometerPage'),
  '/map': () => import('../pages/FleetMapPage'),
  '/payroll': () => import('../pages/PayrollPage'),
  '/stundenzettel': () => import('../pages/StundenzettelPage'),
  '/arbeitszeitbericht': () => import('../pages/ArbeitszeitberichtPage'),
};

const warmed = new Set<string>();

export function prefetchRoute(to: string): void {
  const key = to.split('?')[0];
  if (warmed.has(key)) return;
  const importer = importers[key];
  if (!importer) return;
  warmed.add(key);
  importer().catch(() => warmed.delete(key));
}
