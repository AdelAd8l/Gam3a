import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api, type GoogleStatus } from '../lib/api'
import { durationLabel } from '../lib/format'
import { t, type Key } from '../lib/i18n'

const RESULTS: Record<string, { key: Key; ok: boolean }> = {
  connected: { key: 'google.resultConnected', ok: true },
  cancelled: { key: 'google.resultCancelled', ok: false },
  expired: { key: 'google.resultExpired', ok: false },
  failed: { key: 'google.resultFailed', ok: false },
}

const CLASS_LEADS = [0, 5, 10, 15, 30, 60]
const DEADLINE_LEADS = [0, 60, 180, 720, 1440, 2880]

function leadLabel(minutes: number) {
  if (minutes === 0) return t('google.reminderOff')
  if (minutes === 1440) return t('google.before', { time: t('notify.day') })
  if (minutes === 2880) return t('google.before', { time: t('notify.twoDays') })
  return t('google.before', { time: durationLabel(minutes) })
}

function ago(iso: string | null) {
  if (!iso) return ''
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return minutes < 1 ? t('google.justNow') : minutes < 60 ? t('google.minutesAgo', { n: minutes }) : new Date(iso).toLocaleString()
}

/** Settings → Google Calendar: one calendar per course, in the course's color, kept in sync. */
export default function GoogleCalendarSettings() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const result = RESULTS[params.get('google') ?? '']
  // Always ask the server when this opens: a saved copy would still say "not connected" right
  // after coming back from Google.
  const status = useQuery({ queryKey: ['google'], queryFn: api.googleStatus, staleTime: 0, refetchOnMount: 'always', refetchInterval: 60_000 })
  const [removeCalendars, setRemoveCalendars] = useState(true)
  const [confirming, setConfirming] = useState(false)

  // Arriving from the Schedule page link or back from Google: bring this section into view.
  const arrived = !!result || window.location.hash === '#google'
  useEffect(() => {
    if (arrived && status.data) document.getElementById('google')?.scrollIntoView({ block: 'start' })
  }, [arrived, status.data])

  const update = (s: GoogleStatus) => qc.setQueryData(['google'], s)
  const sync = useMutation({ mutationFn: api.googleSync, onSuccess: update })
  // The checkbox flips at once; the server's answer (after syncing) replaces it.
  const save = useMutation({
    mutationFn: api.googleSettings,
    onMutate: (data) => {
      const before = qc.getQueryData<GoogleStatus>(['google'])
      if (before) update({ ...before, ...data })
      return before
    },
    onError: (_e, _d, before) => before && update(before),
    onSuccess: update,
  })
  const disconnect = useMutation({
    mutationFn: () => api.googleDisconnect(removeCalendars),
    onSuccess: (s) => {
      update(s)
      setConfirming(false)
    },
  })

  const s = status.data
  if (!s) return <div className="panel panel-pad faint">{status.error ? status.error.message : '…'}</div>

  return (
    <div className="stack panel panel-pad">
      {result && (
        <p className={result.ok ? 'google-result' : 'google-result danger-text'} role="status">
          {t(result.key)}{' '}
          <button type="button" className="link-quiet" onClick={() => setParams({}, { replace: true })}>
            {t('sync.dismiss')}
          </button>
        </p>
      )}

      {!s.configured ? (
        <p className="faint help">{t('google.notConfigured')}</p>
      ) : !s.connected ? (
        <div className="google-connect">
          <p className="muted">{t('google.pitch')}</p>
          {/* A full page visit: Google's sign-in page then sends the browser back here. */}
          <a className="btn btn-primary" href="/api/google/connect">
            {t('google.connect')}
          </a>
          <small className="faint">{t('google.privacy')}</small>
        </div>
      ) : (
        <>
          <div className="google-account">
            <div>
              <strong dir="ltr">{s.email || t('google.connected')}</strong>
              <p className="faint help">
                {s.last_error
                  ? ''
                  : t('google.state', { calendars: s.calendars, events: s.events, when: ago(s.last_sync) })}
              </p>
              {s.last_error && <p className="danger-text help">{s.last_error}</p>}
            </div>
            <button type="button" className="btn" disabled={sync.isPending} onClick={() => sync.mutate()}>
              {sync.isPending ? t('google.syncing') : t('google.syncNow')}
            </button>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={s.include_study}
              onChange={(e) => save.mutate({ include_study: e.target.checked })}
            />
            {t('google.includeStudy')}
          </label>
          <div className="google-reminders">
            <label className="field">
              <span>{t('google.classReminder')}</span>
              <select
                className="select"
                value={s.class_reminder}
                onChange={(e) => save.mutate({ class_reminder: Number(e.target.value) })}
              >
                {[...new Set([...CLASS_LEADS, s.class_reminder])].sort((a, b) => a - b).map((m) => (
                  <option key={m} value={m}>
                    {leadLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('google.deadlineReminder')}</span>
              <select
                className="select"
                value={s.deadline_reminder}
                onChange={(e) => save.mutate({ deadline_reminder: Number(e.target.value) })}
              >
                {[...new Set([...DEADLINE_LEADS, s.deadline_reminder])].sort((a, b) => a - b).map((m) => (
                  <option key={m} value={m}>
                    {leadLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="faint help">{t('google.doubleAlerts')}</p>
          <p className="faint help">{t('google.howItWorks')}</p>
          {(sync.error || save.error) && <p className="danger-text">{(sync.error ?? save.error)!.message}</p>}

          {confirming ? (
            <div className="google-disconnect">
              <label className="check">
                <input type="checkbox" checked={removeCalendars} onChange={(e) => setRemoveCalendars(e.target.checked)} />
                {t('google.removeCalendars')}
              </label>
              <div className="form-foot">
                <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
                  {t('common.cancel')}
                </button>
                <button type="button" className="btn btn-danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
                  {t('google.disconnect')}
                </button>
              </div>
            </div>
          ) : (
            <div className="form-foot">
              <button type="button" className="btn btn-quiet" onClick={() => setConfirming(true)}>
                {t('google.disconnect')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
