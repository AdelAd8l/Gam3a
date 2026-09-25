import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, type User } from '../lib/api'
import { t } from '../lib/i18n'
import Logo from './Logo'

/** Shown instead of the app until the person replaces a temporary password with their own. */
export default function PasswordGate({ user }: { user: User }) {
  const qc = useQueryClient()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [mismatch, setMismatch] = useState(false)

  const save = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => qc.setQueryData<User>(['me'], { ...user, must_change_password: false }),
  })
  const signOut = async () => {
    await api.logout()
    qc.clear()
    qc.setQueryData(['me'], null)
  }

  return (
    <div className="gate">
      <form
        className="gate-card panel panel-pad stack"
        onSubmit={(e) => {
          e.preventDefault()
          setMismatch(next !== repeat)
          if (next === repeat) save.mutate()
        }}
      >
        <Logo />
        <div>
          <h1 className="gate-title">{t('gate.title')}</h1>
          <p className="muted">{t(user.is_admin ? 'gate.hintAdmin' : 'gate.hint')}</p>
        </div>
        <label className="field">
          <span>{t('gate.current')}</span>
          <input className="input" dir="ltr" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="field">
          <span>{t('settings.newPassword')}</span>
          <input className="input" dir="ltr" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
          <small className="faint">{t('gate.rule')}</small>
        </label>
        <label className="field">
          <span>{t('gate.repeat')}</span>
          <input className="input" dir="ltr" type="password" autoComplete="new-password" minLength={8} value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
        </label>
        {mismatch && <p className="danger-text">{t('gate.mismatch')}</p>}
        {save.error && <p className="danger-text">{save.error.message}</p>}
        <div className="form-foot">
          <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>
            {t('shell.signOut')}
          </button>
          <button className="btn btn-primary" disabled={save.isPending}>
            {t('gate.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
