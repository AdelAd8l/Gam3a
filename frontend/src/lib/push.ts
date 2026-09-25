// Web Push on this device: ask permission, subscribe through the service worker, tell the server.

import { api } from './api'

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

async function registration() {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function pushState(): Promise<PushState> {
  // iPhone only allows notifications for apps added to the Home Screen.
  if (isIOS() && !standalone()) return 'needs-install'
  if (!('PushManager' in window) || !('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

function toBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function enablePush(): Promise<PushState> {
  if ((await Notification.requestPermission()) !== 'granted') return pushState()
  const reg = (await registration()) ?? (await navigator.serviceWorker.register('/sw.js'))
  await navigator.serviceWorker.ready
  const { public_key } = await api.pushKey()
  let sub = await reg.pushManager.getSubscription()
  // A subscription made with another server key can't be reused.
  if (sub && sub.options.applicationServerKey) {
    const current = new Uint8Array(sub.options.applicationServerKey)
    const wanted = toBytes(public_key)
    if (current.length !== wanted.length || current.some((b, i) => b !== wanted[i])) {
      await sub.unsubscribe()
      sub = null
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(public_key) })
  await api.pushSubscribe(sub.toJSON())
  return 'on'
}

export async function disablePush(): Promise<PushState> {
  const sub = await (await registration())?.pushManager.getSubscription()
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => {})
    await sub.unsubscribe()
  }
  return pushState()
}

/** Re-send this device's subscription (e.g. after signing in again, or if the browser renewed it). */
export async function refreshPush() {
  if ((await pushState()) !== 'on') return
  const sub = await (await registration())?.pushManager.getSubscription()
  if (sub) await api.pushSubscribe(sub.toJSON()).catch(() => {})
}

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Cairo'

/** Stop this device getting the signed-in account's reminders (on sign-out). The browser keeps
 *  its subscription, so signing in again turns reminders back on via refreshPush. */
export async function detachPush() {
  try {
    const sub = await (await registration())?.pushManager.getSubscription()
    if (sub) await api.pushUnsubscribe(sub.endpoint)
  } catch {
    /* offline or unsupported: nothing to detach */
  }
}
