import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import PageHeader from '../components/PageHeader'
import { api, type Scale } from '../lib/api'
import { formatNumber, GRADES, weekdayName } from '../lib/format'
import { useRefresh, useUser } from '../lib/hooks'
import { setLang, t, useLang, type Lang } from '../lib/i18n'

export default function Settings() {
  const user = useUser()
  const qc = useQueryClient()
  const refresh = useRefresh()
  const navigate = useNavigate()
  const lang = useLang()
  const [name, setName] = useState(user.name)
  const [university, setUniversity] = useState(user.university)
  const [scale, setScale] = useState<Scale>(user.scale)
  const [weekStart, setWeekStart] = useState(user.week_start)
  const [cutoffs, setCutoffs] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(user.cutoffs).map(([k, v]) => [k, String(v)])),
  )
  const [defaultTarget, setDefaultTarget] = useState(user.default_target)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')

  const profile = useMutation({
    mutationFn: () => api.updateMe({ name, university }),
    onSuccess: (u) => qc.setQueryData(['me'], u),
  })
  const academic = useMutation({
    mutationFn: () => api.updateMe({ scale, week_start: weekStart }),
    onSuccess: async (u) => {
      qc.setQueryData(['me'], u)
      await refresh()
    },
  })
  const grading = useMutation({
    mutationFn: () =>
      api.updateMe({
        default_target: defaultTarget,
        cutoffs: Object.fromEntries(
          Object.entries(cutoffs)
            .filter(([k]) => k !== 'F')
            .map(([k, v]) => [k, Number(v)]),
        ),
      }),
    onSuccess: async (u) => {
      qc.setQueryData(['me'], u)
      await refresh()
    },
  })
  const password = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      setCurrent('')
      setNext('')
    },
  })
  const remove = useMutation({
    mutationFn: api.deleteMe,
    onSuccess: () => {
      qc.clear()
      qc.setQueryData(['me'], null)
      navigate('/signup')
    },
  })

  return (
    <div className="page page-narrow">
      <PageHeader title={t('nav.settings')} />

      <section className="settings-section">
        <div className="settings-intro">
          <h3>{t('common.language')}</h3>
          <p className="muted">{t('settings.languageHint')}</p>
        </div>
        <div className="panel panel-pad">
          <LanguageSwitch value={lang} onChange={setLang} />
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-intro">
          <h3>{t('settings.profile')}</h3>
          <p className="muted">{t('settings.profileHint')}</p>
        </div>
        <form
          className="stack panel panel-pad"
          onSubmit={(e) => {
            e.preventDefault()
            profile.mutate()
          }}
        >
          <label className="field">
            <span>{t('common.name')}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span>{t('settings.university')}</span>
            <input className="input" value={university} onChange={(e) => setUniversity(e.target.value)} maxLength={120} />
          </label>
          <label className="field">
            <span>{t('common.email')}</span>
            <input className="input" dir="ltr" value={user.email} disabled />
          </label>
          <div className="form-foot">
            {profile.isSuccess && <span className="faint">{t('settings.saved')}</span>}
            {profile.error && <span className="danger-text">{profile.error.message}</span>}
            <button className="btn btn-primary" disabled={profile.isPending}>
              {t('settings.saveProfile')}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-section">
        <div className="settings-intro">
          <h3>{t('settings.academic')}</h3>
          <p className="muted">{t('settings.academicHint')}</p>
        </div>
        <form
          className="stack panel panel-pad"
          onSubmit={(e) => {
            e.preventDefault()
            academic.mutate()
          }}
        >
          <label className="field">
            <span>{t('settings.scale')}</span>
            <select className="select" value={scale} onChange={(e) => setScale(e.target.value as Scale)}>
              <option value="4">{t('settings.scale4')}</option>
              <option value="5">{t('settings.scale5')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('settings.weekStart')}</span>
            <select className="select" value={weekStart} onChange={(e) => setWeekStart(Number(e.target.value))}>
              {[5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {weekdayName(d)}
                </option>
              ))}
            </select>
          </label>
          <div className="form-foot">
            {academic.isSuccess && <span className="faint">{t('settings.saved')}</span>}
            {academic.error && <span className="danger-text">{academic.error.message}</span>}
            <button className="btn btn-primary" disabled={academic.isPending}>
              {t('settings.saveProfile')}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-section">
        <div className="settings-intro">
          <h3>{t('settings.cutoffs')}</h3>
          <p className="muted">{t('settings.cutoffsHint')}</p>
        </div>
        <form
          className="stack panel panel-pad"
          onSubmit={(e) => {
            e.preventDefault()
            grading.mutate()
          }}
        >
          <div className="cutoff-grid">
            {GRADES[user.scale]
              .filter((g) => g !== 'F')
              .map((g) => (
                <label key={g}>
                  <span>{g} ≥</span>
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="any"
                    value={cutoffs[g] ?? ''}
                    onChange={(e) => setCutoffs((c) => ({ ...c, [g]: e.target.value }))}
                    required
                  />
                </label>
              ))}
          </div>
          <label className="field">
            <span>{t('settings.defaultTarget')}</span>
            <select className="select" value={defaultTarget} onChange={(e) => setDefaultTarget(e.target.value)}>
              {GRADES[user.scale].map((g) => (
                <option key={g} value={g}>
                  {g} ({formatNumber(Number(cutoffs[g] ?? 0), 1)}%+)
                </option>
              ))}
            </select>
          </label>
          <div className="form-foot">
            {grading.isSuccess && <span className="faint">{t('settings.saved')}</span>}
            {grading.error && <span className="danger-text">{grading.error.message}</span>}
            <button className="btn btn-primary" disabled={grading.isPending}>
              {t('settings.saveProfile')}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-section">
        <div className="settings-intro">
          <h3>{t('settings.password')}</h3>
          <p className="muted">{t('settings.passwordHint')}</p>
        </div>
        <form
          className="stack panel panel-pad"
          onSubmit={(e) => {
            e.preventDefault()
            password.mutate()
          }}
        >
          <label className="field">
            <span>{t('settings.current')}</span>
            <input className="input" dir="ltr" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </label>
          <label className="field">
            <span>{t('settings.newPassword')}</span>
            <input className="input" dir="ltr" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
          </label>
          <div className="form-foot">
            {password.isSuccess && <span className="faint">{t('settings.passwordChanged')}</span>}
            {password.error && <span className="danger-text">{password.error.message}</span>}
            <button className="btn" disabled={password.isPending}>
              {t('settings.changePassword')}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-section">
        <div className="settings-intro">
          <h3>{t('settings.delete')}</h3>
          <p className="muted">{t('settings.deleteHint')}</p>
        </div>
        <div className="panel panel-pad form-foot">
          <button className="btn btn-danger" onClick={() => confirm(t('settings.confirmDelete')) && remove.mutate()}>
            {t('settings.deleteBtn')}
          </button>
        </div>
      </section>
    </div>
  )
}

export function LanguageSwitch({ value, onChange }: { value: Lang; onChange: (lang: Lang) => void }) {
  return (
    <div className="segmented" role="group" aria-label={t('common.language')}>
      <button type="button" aria-pressed={value === 'en'} onClick={() => onChange('en')} lang="en">
        English
      </button>
      <button type="button" aria-pressed={value === 'ar'} onClick={() => onChange('ar')} lang="ar">
        العربية
      </button>
    </div>
  )
}
