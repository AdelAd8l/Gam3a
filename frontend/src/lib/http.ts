// Raw HTTP to the API. Offline handling lives in offline.ts; this module only talks to the network.

import { serverError, t } from './i18n'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type Query = Record<string, string | number | undefined | null>

export function withQuery(path: string, query?: Query) {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

export async function send<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} }
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  let res: Response
  try {
    res = await fetch(withQuery(`/api${path}`, query), init)
  } catch {
    throw new NetworkError(t('sync.needNetwork'))
  }
  if (!res.ok) {
    let message = res.statusText
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') message = data.detail
      else if (Array.isArray(data.detail)) message = data.detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, '')).join('. ')
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, serverError(message))
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/** Thrown when the request never reached the server (no signal, airplane mode…). */
export class NetworkError extends Error {}
