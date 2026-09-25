import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { api, type User } from '../lib/api'
import { durationLabel } from '../lib/format'
import { t } from '../lib/i18n'
import { disablePush, enablePush, pushState, type PushState } from '../lib/push'

const CLASS_LEADS = [5, 10, 15, 30, 60]
const DEADLINE_LEADS = [60, 180, 720, 1440, 2880]

const leadLabel = (m: number) => (m === 1440 ? t('notify.day') : m === 2880 ? t('notify.twoDays') : durationLabel(m))

/** Settings → Notifications: turn reminders on for this phone and choose how early they come. */
export default function NotificationSettings({ user }: { user: User }) {
  const qc = useQueryClient()
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void pushState().then(setState)
  }, [])

  const toggle = async (on: boolean) => {
    setBusy(true)
    setError('')
    try {
      setState(await (on ? enablePush() : disablePush()))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // The controls change at once (local state); saves run one after another and only the
  // newest answer is applied, so quick taps can't undo each other.
  const pick = (u: User) => ({
    notify_classes: u.notify_classes,
    class_lead: u.class_lead,
    notify_deadlines: u.notify_deadlines,
    deadline_lead: u.deadline_lead,
  })
  const [prefs, setPrefs] = useState(() => pick(user))
  const latest = useRef(0)
  const save = useMutation({
    scope: { id: 'profile' },
    mutationFn: ({ data }: { data: Partial<User>; n: number }) => api.updateMe(data),
    onSuccess: (u, { n }) => {
      if (n !== latest.current) return
      qc.setQueryData(['me'], u)
      setPrefs(pick(u))
    },
    onError: (_e, { n }) => n === latest.current && setPrefs(pick(user)),
  })
  const change = (data: Partial<ReturnType<typeof pick>>) => {
    setPrefs((p) => ({ ...p, ...data }))
    save.mutate({ data, n: ++latest.current })
  }

  const test = useMutation({ mutationFn: api.pushTest })

  const leadSelect = (value: number, options: number[], field: 'class_lead' | 'deadline_lead', label: string) => (
    <select
      className="select"
      aria-label={label}
      value={value}
      onChange={(e) => change({ [field]: Number(e.target.value) })}
    >
      {[...new Set([...options, value])]
        .sort((a, b) => a - b)
        .map((m) => (
          <option key={m} value={m}>
            {t('notify.before', { time: leadLabel(m) })}
          </option>
        ))}
    </select>
  )

  return (
    <div className="stack panel panel-pad">
      <div className="notify-device">
        <div>
          <strong>{t('notify.thisDevice')}</strong>
          <p className="faint help">
            {state === 'on'
              ? t('notify.on')
              : state === 'needs-install'
                ? t('notify.needsInstall')
                : state === 'denied'
                  ? t('notify.denied')
                  : state === 'unsupported'
                    ? t('notify.unsupported')
                    : t('notify.off')}
          </p>
        </div>
        {(state === 'on' || state === 'off') && (
          <button
            type="button"
            className={state === 'on' ? 'btn' : 'btn btn-primary'}
            disabled={busy}
            onClick={() => void toggle(state === 'off')}
          >
            {state === 'on' ? t('notify.turnOff') : t('notify.turnOn')}
          </button>
        )}
      </div>

      <div className="notify-row">
        <label className="check">
          <input
            type="checkbox"
            checked={prefs.notify_classes}
            onChange={(e) => change({ notify_classes: e.target.checked })}
          />
          {t('notify.classes')}
        </label>
        {prefs.notify_classes && leadSelect(prefs.class_lead, CLASS_LEADS, 'class_lead', t('notify.classes'))}
      </div>
      <div className="notify-row">
        <label className="check">
          <input
            type="checkbox"
            checked={prefs.notify_deadlines}
            onChange={(e) => change({ notify_deadlines: e.target.checked })}
          />
          {t('notify.deadlines')}
        </label>
        {prefs.notify_deadlines && leadSelect(prefs.deadline_lead, DEADLINE_LEADS, 'deadline_lead', t('notify.deadlines'))}
      </div>
      <p className="faint help">{t('notify.untimed', { zone: user.timezone })}</p>

      <div className="form-foot">
        {test.isSuccess && <span className="faint">{t('notify.testSent')}</span>}
        {(error || save.error || test.error) && (
          <span className="danger-text">{error || (save.error ?? test.error)!.message}</span>
        )}
        {state === 'on' && (
          <button type="button" className="btn btn-quiet" disabled={test.isPending} onClick={() => test.mutate()}>
            {t('notify.test')}
          </button>
        )}
      </div>
    </div>
  )
}
