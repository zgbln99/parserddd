import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { useI18n } from '../i18n';

export function OfflineBanner() {
  const { t } = useI18n();
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="fixed left-0 right-0 top-0 z-[100] flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg">
      <WifiOff size={14} />
      {t('offlineMode')}
    </div>
  );
}
