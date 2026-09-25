// Offline support: every change is written to an "outbox" kept on the phone, shown on
// screen straight away, and sent to the server in order as soon as there's a connection.
//
// - Online and nothing waiting: the change goes straight to the server (normal behaviour).
// - Offline, or older changes still waiting: the change joins the outbox, the React Query
//   cache is updated so the screen shows it, and the result is a stand-in object.
// - New items made offline get a temporary negative id. When the server creates them,
//   later outbox entries that mention that id are rewritten to the real one.

import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

import type { Assessment, Busy, Course, Progress, Term } from './api'
import { ApiError, NetworkError, send } from './http'

interface Entry {
  id: string
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  tempId?: number // for POSTs made offline
  at: number
}

export interface SyncState {
  online: boolean
  pending: number
  syncing: boolean
  failed: number // changes the server rejected (e.g. invalid after a conflict)
}

const KEY = 'gam3a.outbox'
const FAILED_KEY = 'gam3a.outbox.failed'
let client: QueryClient | null = null
let syncing = false
const listeners = new Set<() => void>()

// ---- storage ---------------------------------------------------------------------

function load(key = KEY): Entry[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as Entry[]
  } catch {
    return []
  }
}

function save(entries: Entry[], key = KEY) {
  try {
    localStorage.setItem(key, JSON.stringify(entries))
  } catch {
    /* storage full or unavailable: keep going in memory */
  }
  emit()
}

let snapshot: SyncState = computeState()
function computeState(): SyncState {
  return { online: navigator.onLine, pending: load().length, syncing, failed: load(FAILED_KEY).length }
}
function emit() {
  snapshot = computeState()
  listeners.forEach((fn) => fn())
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => snapshot,
  )
}

export function clearFailed() {
  save([], FAILED_KEY)
}

export const pendingCount = () => load().length

/** Forget everything queued (signing out, deleting the account). */
export function clearOutbox() {
  save([])
  save([], FAILED_KEY)
}

/** Server unreachable or restarting behind the proxy: worth trying again later. */
const retryable = (e: unknown) => e instanceof NetworkError || (e instanceof ApiError && [502, 503, 504].includes(e.status))

// ---- writing ---------------------------------------------------------------------

let nextTemp = -Date.now()

export async function write<T>(method: string, path: string, body?: unknown): Promise<T> {
  const m = method as Entry['method']
  if (load().length === 0 && navigator.onLine) {
    try {
      return await send<T>(m, path, body)
    } catch (e) {
      if (!retryable(e)) throw e // a real error from the server: show it
    }
  }
  // Offline (or earlier changes still queued): keep it on the phone.
  const entry: Entry = { id: crypto.randomUUID(), method: m, path, body, at: Date.now() }
  if (m === 'POST') entry.tempId = nextTemp--
  save([...load(), entry])
  const result = standIn(entry)
  applyToCache(entry, result)
  void syncNow()
  return result as T
}

/** What the server would probably answer, so the screen can show the change right away. */
function standIn(entry: Entry): unknown {
  if (entry.method === 'DELETE') return undefined
  const body = (entry.body ?? {}) as Record<string, unknown>
  const [, resource, rawId] = entry.path.split('/')
  const id = entry.tempId ?? Number(rawId)
  const previous = findCached(resource, id)
  if (resource === 'courses' && entry.path.endsWith('/grade')) return { ...previous, grade: body.grade ?? null }
  const merged: Record<string, unknown> = { ...previous, ...body, id }
  if (resource === 'courses') {
    merged.meetings = ((body.meetings as unknown[]) ?? []).map((m, i) => ({ id: -(i + 1), ...(m as object) }))
    merged.progress ??= emptyProgress()
  }
  if (resource === 'assessments' && body.points_earned != null && body.points_max) {
    merged.score = ((body.points_earned as number) / (body.points_max as number)) * 100
    merged.done = true
  }
  return merged
}

function emptyProgress(): Progress {
  return {
    target_grade: 'A',
    target_percent: 93,
    graded_weight: 0,
    listed_weight: 0,
    earned: 0,
    remaining_weight: 100,
    current: null,
    current_letter: null,
    max_possible: 100,
    max_letter: 'A+',
    required: null,
    status: 'no_data',
  }
}

// ---- optimistic cache updates -------------------------------------------------------

type Item = { id: number } & Record<string, unknown>

function findCached(resource: string, id: number): Item | undefined {
  if (!client) return undefined
  for (const [, data] of client.getQueriesData<unknown>({ queryKey: [resource] })) {
    const list = Array.isArray(data) ? data : data ? [data] : []
    const hit = (list as Item[]).find((x) => x?.id === id)
    if (hit) return hit
  }
  return undefined
}

function courseTerm(courseId: number): number | undefined {
  return (findCached('courses', courseId) as Course | undefined)?.term_id
}

/** Should `item` appear in the list cached under `key`? Mirrors the API's filters. */
function belongs(resource: string, key: QueryKey, item: Item): boolean {
  switch (resource) {
    case 'terms':
      return true
    case 'busy':
      return (item as unknown as Busy).term_id === key[1]
    case 'courses': {
      const c = item as unknown as Course
      if (key[1] === 'all') return true
      if (key[1] === 'one') return key[2] === c.id
      return c.term_id === key[1]
    }
    case 'assessments': {
      const a = item as unknown as Assessment
      if (key[1] === 'course') return a.course_id === key[2]
      if (key[1] === 'term') return courseTerm(a.course_id) === key[2]
      if (key[1] === 'due') {
        const [, , termId, today] = key as [string, string, number, string]
        const soon = new Date(`${today}T00:00:00`)
        soon.setDate(soon.getDate() + 7)
        const limit = soon.toISOString().slice(0, 10)
        return !a.done && !!a.due_date && a.due_date <= limit && courseTerm(a.course_id) === termId
      }
      return false
    }
  }
  return false
}

function applyToCache(entry: Entry, result: unknown) {
  if (!client) return
  const [, resource, rawId] = entry.path.split('/')
  const id = entry.tempId ?? Number(rawId)
  for (const [key, data] of client.getQueriesData<unknown>({ queryKey: [resource] })) {
    if (Array.isArray(data)) {
      let list = (data as Item[]).filter((x) => x.id !== id)
      if (entry.method !== 'DELETE' && result && belongs(resource, key, result as Item)) {
        const at = (data as Item[]).findIndex((x) => x.id === id)
        list = [...list]
        list.splice(at >= 0 ? at : list.length, 0, result as Item)
      }
      client.setQueryData(key, list)
    } else if (data && (data as Item).id === id && entry.method !== 'DELETE') {
      client.setQueryData(key, result)
    }
  }
}

// ---- syncing ---------------------------------------------------------------------

/** Replace temporary ids with real ones in a later entry's path and body. */
function remap(entry: Entry, ids: Map<number, number>): Entry {
  if (!ids.size) return entry
  const path = entry.path.replace(/\/(-\d+)(?=\/|$)/g, (m, id) => (ids.has(Number(id)) ? `/${ids.get(Number(id))}` : m))
  const body = entry.body
    ? JSON.parse(JSON.stringify(entry.body), (k, v) =>
        typeof v === 'number' && v < 0 && k.endsWith('_id') && ids.has(v) ? ids.get(v) : v,
      )
    : entry.body
  return { ...entry, path, body }
}

let running: Promise<void> | null = null

/** Send queued changes in order. Callers during a run share it, so a read can wait for it. */
export function syncNow(): Promise<void> {
  if (running) return running
  if (!navigator.onLine || load().length === 0) return Promise.resolve()
  running = replay().finally(() => {
    running = null
    syncing = false
    emit()
  })
  return running
}

async function replay() {
  syncing = true
  emit()
  const ids = new Map<number, number>()
  let sent = 0
  for (;;) {
    const [head, ...rest] = load()
    if (!head) break
    const entry = remap(head, ids)
    try {
      const res = await send<{ id?: number } | undefined>(entry.method, entry.path, entry.body)
      if (entry.tempId && res?.id) ids.set(entry.tempId, res.id)
      sent++
    } catch (e) {
      if (retryable(e)) break // still offline: try again later
      if (e instanceof ApiError && e.status === 401) break // signed out: keep it until they sign in
      // The server refused this one (e.g. its course was deleted elsewhere): set it aside.
      const note = { ...(entry.body as object), error: (e as Error).message }
      save([...load(FAILED_KEY), { ...entry, body: note }], FAILED_KEY)
    }
    save(rest.map((x) => remap(x, ids)))
  }
  // Refetch in the background (not awaited: those reads would wait on this very run).
  if (sent && client) void client.invalidateQueries()
}

/** Wire the outbox to the app: remember the query cache and sync whenever a connection appears. */
export function startOfflineSync(qc: QueryClient) {
  client = qc
  const kick = () => {
    emit()
    void syncNow()
  }
  window.addEventListener('online', kick)
  window.addEventListener('offline', emit)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && kick())
  setInterval(() => load().length && kick(), 30_000)
  kick()
}

export const _test = { remap, load, belongs }
export type { Entry, Term }
