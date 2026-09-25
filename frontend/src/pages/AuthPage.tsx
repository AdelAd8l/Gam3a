import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import Logo from '../components/Logo'
import { api, type Scale } from '../lib/api'
import { formatTime, weekdayName } from '../lib/format'
import { setLang, t, useLang } from '../lib/i18n'
import { browserTimeZone } from '../lib/push'
import { LanguageSwitch } from './Settings'

// A day from a timetable, drawn as the sign-in page artwork.
const ART = [
  { start: '08:30', end: '10:00', key: 'auth.art1', color: '#3E5C8A', kind: 'class' },
  { start: '10:30', end: '12:00', key: 'auth.art2', color: '#4E7D5B', kind: 'study' },
  { start: '14:00', end: '16:00', key: 'auth.art3', color: '#8A5A3E', kind: 'class' },
] as const

export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const lang = useLang()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [university, setUniversity] = useState('')
  const [scale, setScale] = useState<Scale>('4')
  const signup = mode === 'signup'

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () =>
      fetch('/api/health').then(
        (r) => r.json() as Promise<{ signup?: boolean; demo?: { email: string; password: string } }>,
      ),
    staleTime: Infinity,
  })

  const submit = useMutation({
    mutationFn: (creds?: { email: string; password: string }) =>
      creds
        ? api.login(creds.email, creds.password)
        : signup
          ? api.register({ name, email, password, university, scale, timezone: browserTimeZone() })
          : api.login(email, password),
    onSuccess: (user) => {
      qc.setQueryData(['me'], user)
      navigate('/')
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    submit.mutate(undefined)
  }

  const demo = health.data?.demo
  // Only offer sign-up once the server confirms it's open (no flash of the link when closed).
  const signupOpen = health.data?.signup === true

  return (
    <div className="auth">
      <div className="auth-form-col">
        <div className="auth-top">
          <Logo size={26} />
          <LanguageSwitch value={lang} onChange={setLang} />
        </div>
        <div className="auth-form-wrap">
          <h1>{signup ? t('auth.signupTitle') : t('auth.loginTitle')}</h1>
          <p className="muted auth-lede">{signup ? t('auth.signupLede') : t('auth.loginLede')}</p>

          <form className="stack" onSubmit={onSubmit}>
            {signup && (
              <label className="field">
                <span>{t('common.name')}</span>
                <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
            )}
            <label className="field">
              <span>{t('common.email')}</span>
              <input
                className="input"
                dir="ltr"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>{t('common.password')}</span>
              <input
                className="input"
                dir="ltr"
                type="password"
                autoComplete={signup ? 'new-password' : 'current-password'}
                minLength={signup ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {signup && (
              <div className="grid-2">
                <label className="field">
                  <span>
                    {t('settings.university')} <span className="faint">({t('common.optional')})</span>
                  </span>
                  <input className="input" value={university} onChange={(e) => setUniversity(e.target.value)} maxLength={120} />
                </label>
                <label className="field">
                  <span>{t('settings.scale')}</span>
                  <select className="select" value={scale} onChange={(e) => setScale(e.target.value as Scale)}>
                    <option value="4">{t('settings.scale4')}</option>
                    <option value="5">{t('settings.scale5')}</option>
                  </select>
                </label>
              </div>
            )}
            {submit.error && <p className="form-error">{submit.error.message}</p>}
            <button className="btn btn-primary btn-block" disabled={submit.isPending}>
              {submit.isPending ? t('auth.wait') : signup ? t('auth.create') : t('auth.signIn')}
            </button>
            {demo && (
              <button type="button" className="btn btn-block" onClick={() => submit.mutate(demo)}>
                {t('auth.demo')}
              </button>
            )}
          </form>

          <p className="auth-switch muted">
            {signup ? (
              <>
                {t('auth.haveAccount')} <Link to="/login">{t('auth.signIn')}</Link>
              </>
            ) : signupOpen ? (
              <>
                {t('auth.newHere')} <Link to="/signup">{t('auth.createLink')}</Link>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <aside className="auth-art" aria-hidden="true">
        <div className="art-card">
          <div className="art-head">
            <span>{weekdayName(6)}</span>
            <span className="faint">{t('today.week', { n: 5, total: 14 })}</span>
          </div>
          <ul>
            {ART.map((a) => (
              <li key={a.key} className={`art-${a.kind}`} style={{ '--c': a.color } as React.CSSProperties}>
                <span className="num faint">{formatTime(a.start)}</span>
                <span>
                  <strong>{t(a.key)}</strong>
                  <span className="faint">
                    {formatTime(a.start)} – {formatTime(a.end)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="auth-quote">{t('auth.quote')}</p>
      </aside>
    </div>
  )
}
