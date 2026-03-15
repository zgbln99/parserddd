import './styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import { I18nProvider } from './i18n';
import { ThemeProvider } from './hooks/useTheme';
import { DateFilterProvider } from './hooks/useDateFilter';
import { App } from './App';
import { ToastProvider } from './components/Toast';

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <DateFilterProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </DateFilterProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
