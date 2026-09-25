// Builds /sw.js: a small service worker that keeps the app shell on the phone so Gam3a
// opens with no connection, and shows reminder notifications. Data is not handled here
// (React Query keeps it, see main.tsx).

import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import type { Plugin } from 'vite'

const worker = (version: string, files: string[]) => `// Generated at build time. Do not edit.
const CACHE = 'gam3a-${version}'
const SHELL = ${JSON.stringify(files)}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gam3a-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Pages: try the network (with a short timeout for weak signal), fall back to the saved shell.
async function page(request) {
  const cache = await caches.open(CACHE)
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000)),
    ])
    if (res.ok) cache.put('/', res.clone())
    return res
  } catch {
    return (await cache.match('/')) || Response.error()
  }
}

// Built files have hashed names, so a saved copy is always right.
async function asset(request) {
  const hit = await caches.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) (await caches.open(CACHE)).put(request, res.clone())
  return res
}

// Reminders sent by the server (see backend/app/notify.py).
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Gam3a', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    }),
  )
})

// Tapping a reminder opens the app (or focuses it) on the right page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(location.origin))
      if (open) return open.focus().then((c) => (c && 'navigate' in c ? c.navigate(url) : c))
      return self.clients.openWindow(url)
    }),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return
  event.respondWith(request.mode === 'navigate' ? page(request) : asset(request))
})
`

export default function serviceWorker(): Plugin {
  let publicDir = 'public'
  return {
    name: 'gam3a-service-worker',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir
    },
    generateBundle(_, bundle) {
      // Fonts: only the woff2 files for the scripts the app uses; the rest load on demand.
      const wanted = (f: string) =>
        !f.endsWith('.html') && !f.endsWith('.map') && (!/\.woff2?$/.test(f) || /-(latin|arabic)-\d+-normal.*\.woff2$/.test(f))
      const built = Object.keys(bundle).filter(wanted)
      const pub = readdirSync(publicDir)
      const files = ['/', ...[...built, ...pub].map((f) => `/${f}`)]
      const version = createHash('sha256').update(files.sort().join('\n')).digest('hex').slice(0, 10)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker(version, files) })
    },
  }
}
