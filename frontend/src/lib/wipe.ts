// Several people can use one phone or computer. Whatever the app keeps on the device (the saved copy of
// the data, the changes waiting to be sent) belongs to one account and must never be shown to, or sent
// as, another one.

import type { QueryClient } from '@tanstack/react-query'

import { clearOutbox } from './offline'

const OWNER = 'gam3a.owner' // id of the account the saved data and the outbox belong to
const CACHE = 'gam3a.cache'

const remember = (id: number | null) => {
  try {
    if (id === null) localStorage.removeItem(OWNER)
    else localStorage.setItem(OWNER, String(id))
  } catch {
    /* storage unavailable */
  }
}

/** Forget everything about the signed-in person on this device (signing out, deleting the account). */
export function wipeDevice(qc: QueryClient) {
  clearOutbox()
  qc.clear()
  remember(null)
  try {
    localStorage.removeItem(CACHE)
  } catch {
    /* storage unavailable */
  }
}

/** The server session ended: drop the saved data from the screen's reach but keep the outbox,
 * which is sent when the same person signs in again. */
export function dropPrivateData(qc: QueryClient) {
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
}

/** Called whenever the app learns who is signed in. If it is not the person the saved data and
 * the waiting changes belong to, throw those away first. */
export function adoptUser(qc: QueryClient, id: number | null | undefined) {
  if (typeof id !== 'number') return
  let owner: string | null = null
  try {
    owner = localStorage.getItem(OWNER)
  } catch {
    /* storage unavailable */
  }
  if (owner !== null && owner !== String(id)) {
    clearOutbox()
    dropPrivateData(qc)
  }
  if (owner !== String(id)) remember(id)
}
