import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import './index.css'
import './app.css'

import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { onlineManager, QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { ApiError } from './lib/api'
import { NetworkError } from './lib/http'
import { startOfflineSync } from './lib/offline'

const WEEK = 7 * 24 * 60 * 60 * 1000

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Keep the last copy for a week so the app opens without a connection.
      gcTime: WEEK,
      // On reconnect the outbox syncs first, then refreshes everything itself.
      refetchOnReconnect: false,
      retry: (count, error) =>
        !(error instanceof NetworkError) && !(error instanceof ApiError && error.status < 500) && count < 2,
    },
    // Writes never pause: offline they go to the outbox (see lib/offline.ts).
    mutations: { networkMode: 'always' },
  },
})

// React Query assumes "online" until an event says otherwise; opening the app offline sends none.
onlineManager.setOnline(navigator.onLine)

const persister = createSyncStoragePersister({ storage: window.localStorage, key: 'gam3a.cache', throttleTime: 500 })
startOfflineSync(queryClient)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{
        persister,
        maxAge: WEEK,
        buster: 'v1',
        // Keep anything we have data for, even if its last refresh failed for lack of signal.
        dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.data !== undefined },
      }}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
)
