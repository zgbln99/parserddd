import { useState } from 'react';
import { Shield, Users, Key, Settings, Activity } from 'lucide-react';
import { useI18n } from '../i18n';
import { UsersTab } from '../components/admin/UsersTab';
import { SecurityTab } from '../components/admin/SecurityTab';
import { SyncConfigTab } from '../components/admin/SyncConfigTab';
import { LogsTab } from '../components/admin/LogsTab';

type AdminTab = 'users' | 'security' | 'sync' | 'logs';

const tabs: { key: AdminTab; icon: typeof Users; labelKey: string; color: string }[] = [
  { key: 'users', icon: Users, labelKey: 'adminUsers', color: 'text-blue-500' },
  { key: 'security', icon: Key, labelKey: 'adminChangePassword', color: 'text-amber-500' },
  { key: 'sync', icon: Settings, labelKey: 'adminSyncConfig', color: 'text-muted dark:text-muted-dark' },
  { key: 'logs', icon: Activity, labelKey: 'adminActivityLog', color: 'text-violet-500' },
];

export function AdminPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  return (
    <div className="animate-slide-up space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg shadow-red-500/20">
          <Shield size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('adminTitle')}</h1>
          <p className="text-xs text-muted dark:text-muted-dark">System & Security</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl bg-black/[0.04] p-1 dark:bg-white/5">
        {tabs.map(({ key, icon: Icon, labelKey, color }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
              activeTab === key
                ? 'glass-card text-gray-900 dark:text-gray-100'
                : 'text-muted dark:text-muted-dark hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Icon size={16} className={activeTab === key ? color : ''} />
            <span className="hidden sm:inline">{t(labelKey as never)}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'security' && <SecurityTab />}
        {activeTab === 'sync' && <SyncConfigTab />}
        {activeTab === 'logs' && <LogsTab />}
      </div>
    </div>
  );
}
