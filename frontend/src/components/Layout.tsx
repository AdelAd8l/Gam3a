import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

import { api, type Assessment, type Course, type Term, type User } from '../lib/api'
import { pickDefaultTerm } from '../lib/format'
import { DialogContext, TermContext, useTerms } from '../lib/hooks'
import { t, type Key } from '../lib/i18n'
import { clearOutbox } from '../lib/offline'
import AssessmentDialog from './AssessmentDialog'
import CourseDialog from './CourseDialog'
import Icon, { type IconName } from './Icon'
import Logo from './Logo'
import SyncStatus from './SyncStatus'
import TermDialog from './TermDialog'

const NAV: { to: string; label: Key; icon: IconName }[] = [
  { to: '/', label: 'nav.today', icon: 'sun' },
  { to: '/schedule', label: 'nav.schedule', icon: 'grid' },
  { to: '/courses', label: 'nav.courses', icon: 'book' },
  { to: '/deadlines', label: 'nav.deadlines', icon: 'flag' },
  { to: '/grades', label: 'nav.grades', icon: 'chart' },
  { to: '/terms', label: 'nav.terms', icon: 'layers' },
  { to: '/settings', label: 'nav.settings', icon: 'gear' },
]

const TERM_KEY = 'gam3a.term'

function readSavedTerm(): number | null {
  try {
    const v = Number(localStorage.getItem(TERM_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

type Open<T> = { item?: T; key: number } | null

export default function Layout({ user }: { user: User }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: terms = [], isPending } = useTerms()
  const [chosen, setChosen] = useState<number | null>(readSavedTerm)

  const term = useMemo(() => terms.find((x) => x.id === chosen) ?? pickDefaultTerm(terms), [terms, chosen])
  const setTermId = useCallback((id: number) => {
    setChosen(id)
    try {
      localStorage.setItem(TERM_KEY, String(id))
    } catch {
      /* storage unavailable */
    }
  }, [])

  // Dialogs are remounted (new key) on every open so their state always starts fresh.
  const [courseDlg, setCourseDlg] = useState<Open<Course>>(null)
  const [termDlg, setTermDlg] = useState<Open<Term>>(null)
  const [assessDlg, setAssessDlg] = useState<(Open<Assessment> & { courseId?: number }) | null>(null)
  const dialogs = useMemo(
    () => ({
      editCourse: (item?: Course) => setCourseDlg({ item, key: Date.now() }),
      editTerm: (item?: Term) => setTermDlg({ item, key: Date.now() }),
      editAssessment: (item?: Assessment, preset?: { course_id?: number }) =>
        setAssessDlg({ item, courseId: preset?.course_id, key: Date.now() }),
    }),
    [],
  )

  // "D" anywhere (outside a field) adds a deadline; e.code works on an Arabic keyboard too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.code !== 'KeyD' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      if (target.closest('input, textarea, select, [contenteditable], dialog')) return
      e.preventDefault()
      dialogs.editAssessment()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialogs])

  async function signOut() {
    await api.logout()
    clearOutbox()
    qc.clear()
    qc.setQueryData(['me'], null)
    navigate('/login')
  }

  return (
    <TermContext.Provider value={{ term, terms, setTermId }}>
      <DialogContext.Provider value={dialogs}>
        <div className="shell">
          <aside className="sidebar">
            <div className="sidebar-top">
              <Logo />
              {term && (
                <label className="term-switch">
                  <span className="visually-hidden">{t('shell.term')}</span>
                  <select className="select" value={term.id} onChange={(e) => setTermId(Number(e.target.value))}>
                    {terms.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button className="btn btn-primary new-btn" onClick={() => dialogs.editAssessment()} disabled={!term}>
                <Icon name="plus" size={16} />
                {t('shell.addDeadline')}
                <kbd>D</kbd>
              </button>
            </div>
            <nav className="nav" aria-label={t('nav.main')}>
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav-link">
                  <Icon name={item.icon} />
                  <span>{t(item.label)}</span>
                </NavLink>
              ))}
            </nav>
            <div className="sidebar-user">
              <div className="avatar" aria-hidden="true">
                {user.name.trim().charAt(0).toUpperCase()}
              </div>
              <div className="sidebar-user-text">
                <strong>{user.name}</strong>
                <span className="faint">{user.university || user.email}</span>
              </div>
              <button
                className="btn btn-quiet icon-btn"
                onClick={signOut}
                aria-label={t('shell.signOut')}
                title={t('shell.signOut')}
              >
                <Icon name="logout" flip />
              </button>
            </div>
          </aside>

          <main className="main">
            {isPending ? null : term ? <Outlet /> : <Welcome onCreate={() => dialogs.editTerm()} />}
          </main>

          <SyncStatus />

          {term && (
            <button
              className="fab btn btn-primary"
              onClick={() => dialogs.editAssessment()}
              aria-label={t('shell.addDeadline')}
            >
              <Icon name="plus" size={22} />
            </button>
          )}
        </div>

        <CourseDialog
          key={`c${courseDlg?.key ?? 0}`}
          open={!!courseDlg}
          course={courseDlg?.item}
          onClose={() => setCourseDlg(null)}
        />
        <TermDialog
          key={`t${termDlg?.key ?? 0}`}
          open={!!termDlg}
          term={termDlg?.item}
          onClose={() => setTermDlg(null)}
          onCreated={(created) => setTermId(created.id)}
        />
        <AssessmentDialog
          key={`a${assessDlg?.key ?? 0}`}
          open={!!assessDlg}
          item={assessDlg?.item}
          courseId={assessDlg?.courseId}
          onClose={() => setAssessDlg(null)}
        />
      </DialogContext.Provider>
    </TermContext.Provider>
  )
}

function Welcome({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="page page-narrow">
      <div className="welcome">
        <h1>{t('welcome.title')}</h1>
        <p className="muted">{t('welcome.body')}</p>
        <button className="btn btn-primary" onClick={onCreate}>
          {t('welcome.cta')}
        </button>
      </div>
    </div>
  )
}
