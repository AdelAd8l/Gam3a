// While there is a connection, quietly fetch every screen's data so the whole app works with no signal: the terms,
// and for each term its courses, timings, study plan and deadlines, plus every course's own page and the grades.
// What is already fresh is not fetched again.

import type { QueryClient } from '@tanstack/react-query'

import { api } from './api'
import { addDays, todayISO } from './format'

const FRESH = 30 * 60_000 // not fetched again within half an hour
const EVERY = 20 * 60_000 // and the whole round at most this often
let running = false
let lastRun = 0

export async function warmCache(qc: QueryClient, force = false) {
  if (running || !navigator.onLine || !qc.getQueryData(['me'])) return
  if (!force && Date.now() - lastRun < EVERY) return
  running = true
  try {
    const staleTime = FRESH
    const terms = await qc.fetchQuery({ queryKey: ['terms'], queryFn: api.terms, staleTime })
    await Promise.all([
      qc.prefetchQuery({ queryKey: ['courses', 'all'], queryFn: () => api.courses(), staleTime }),
      qc.prefetchQuery({ queryKey: ['grades'], queryFn: api.grades, staleTime }),
    ])
    const today = todayISO()
    for (const term of terms) {
      if (!navigator.onLine) break
      const [courses] = await Promise.all([
        qc.fetchQuery({ queryKey: ['courses', term.id], queryFn: () => api.courses(term.id), staleTime }),
        qc.prefetchQuery({ queryKey: ['plan', term.id], queryFn: () => api.plan(term.id), staleTime }),
        qc.prefetchQuery({ queryKey: ['busy', term.id], queryFn: () => api.busy(term.id), staleTime }),
        qc.prefetchQuery({ queryKey: ['assessments', 'term', term.id], queryFn: () => api.assessments({ term_id: term.id }), staleTime }),
        qc.prefetchQuery({
          queryKey: ['assessments', 'due', term.id, today],
          queryFn: () => api.assessments({ term_id: term.id, open_only: 'true', end: addDays(today, 7) }),
          staleTime,
        }),
      ])
      for (const c of courses) {
        if (!navigator.onLine) break
        await Promise.all([
          qc.prefetchQuery({ queryKey: ['courses', 'one', c.id], queryFn: () => api.course(c.id), staleTime }),
          qc.prefetchQuery({ queryKey: ['assessments', 'course', c.id], queryFn: () => api.assessments({ course_id: c.id }), staleTime }),
        ])
      }
    }
  } catch {
    /* the connection dropped, or a hiccup: the next round continues */
  } finally {
    running = false
    lastRun = Date.now()
  }
}

/** Start warming a little after the app opens, whenever it comes back to the screen, and when the connection returns. */
export function startWarmup(qc: QueryClient) {
  const later = (ms: number) => window.setTimeout(() => void warmCache(qc), ms)
  later(4000)
  window.addEventListener('online', () => later(3000))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && later(1500))
}
