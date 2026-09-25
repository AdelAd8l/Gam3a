import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'

import Icon from '../components/Icon'
import Modal from '../components/Modal'
import PageHeader from '../components/PageHeader'
import { api, type AdminUser, type Scale } from '../lib/api'
import { formatDate } from '../lib/format'
import { useUser } from '../lib/hooks'
import { t } from '../lib/i18n'

/** Every account on this server: search, edit, reset a password, delete with all its data. */
export default function Admin() {
  const me = useUser()
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search.trim())
  const users = useQuery({ queryKey: ['admin', 'users', q], queryFn: () => api.adminUsers(q) })
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [deleting, setDeleting] = useState<AdminUser | null>(null)

  return (
    <div className="page page-narrow">
      <PageHeader title={t('admin.title')} />
      <p className="muted admin-lede">{t('admin.hint')}</p>

      <SignupSwitch />

      <label className="search admin-search">
        <span className="visually-hidden">{t('admin.search')}</span>
        <input
          className="input"
          type="search"
          dir="auto"
          placeholder={t('admin.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      {users.error && <p className="danger-text">{users.error.message}</p>}
      <p className="faint admin-count">{users.data && t('admin.count', { n: users.data.length })}</p>

      <ul className="admin-list panel">
        {users.data?.map((u) => (
          <li key={u.id} className="admin-row">
            <div className="admin-who">
              <strong>
                {u.name}
                {u.id === me.id && <span className="faint"> · {t('admin.you')}</span>}
              </strong>
              <span className="admin-email" dir="ltr">
                {u.email}
              </span>
              <span className="faint admin-meta">
                {t('admin.joined', { date: formatDate(u.created_at.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) })}
                {' · '}
                {t('admin.data', { terms: u.terms, courses: u.courses, items: u.assessments })}
              </span>
              <span className="admin-badges">
                {u.is_admin && <span className="tag tag-accent">{t('admin.badgeAdmin')}</span>}
                {u.must_change_password && <span className="tag">{t('admin.badgeReset')}</span>}
              </span>
            </div>
            <div className="admin-actions">
              <button className="btn" onClick={() => setEditing(u)}>
                {t('admin.edit')}
              </button>
              {u.id !== me.id && (
                <button className="btn btn-quiet icon-btn danger-text" onClick={() => setDeleting(u)} aria-label={`${t('admin.delete')} ${u.email}`}>
                  <Icon name="trash" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {editing && <EditUser key={editing.id} user={editing} self={editing.id === me.id} onClose={() => setEditing(null)} />}
      {deleting && <DeleteUser key={deleting.id} user={deleting} onClose={() => setDeleting(null)} />}
    </div>
  )
}

function EditUser({ user, self, onClose }: { user: AdminUser; self: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [university, setUniversity] = useState(user.university)
  const [scale, setScale] = useState<Scale>(user.scale)
  const [isAdmin, setIsAdmin] = useState(user.is_admin)
  const [password, setPassword] = useState('')

  const save = useMutation({
    mutationFn: () =>
      api.adminUpdateUser(user.id, {
        name,
        email,
        university,
        scale,
        is_admin: isAdmin,
        ...(password ? { new_password: password } : {}),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin'] })
      if (self) await qc.invalidateQueries({ queryKey: ['me'] })
      onClose()
    },
  })

  return (
    <Modal title={t('admin.editTitle')} open onClose={onClose} width={440}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <label className="field">
          <span>{t('common.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        </label>
        <label className="field">
          <span>{t('common.email')}</span>
          <input className="input" dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>{t('settings.university')}</span>
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
        <label className="field">
          <span>{t('admin.newPassword')}</span>
          <input
            className="input"
            dir="ltr"
            type="text"
            autoComplete="off"
            minLength={8}
            placeholder={t('admin.newPasswordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <small className="faint">{t(self ? 'admin.newPasswordSelf' : 'admin.newPasswordHint')}</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={isAdmin} disabled={self} onChange={(e) => setIsAdmin(e.target.checked)} />
          {t('admin.isAdmin')}
        </label>
        {save.error && <p className="danger-text">{save.error.message}</p>}
        <div className="form-foot">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={save.isPending}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function DeleteUser({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const qc = useQueryClient()
  const [typed, setTyped] = useState('')
  const remove = useMutation({
    mutationFn: () => api.adminDeleteUser(user.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin'] })
      onClose()
    },
  })
  const matches = typed.trim().toLowerCase() === user.email.toLowerCase()

  return (
    <Modal title={t('admin.deleteTitle')} open onClose={onClose} width={440}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          if (matches) remove.mutate()
        }}
      >
        <p>{t('admin.deleteWarning', { name: user.name })}</p>
        <ul className="admin-delete-list">
          <li>{t('admin.deleteAccount')}</li>
          <li>{t('admin.data', { terms: user.terms, courses: user.courses, items: user.assessments })}</li>
          <li>{t('admin.deleteRest')}</li>
        </ul>
        <label className="field">
          <span>{t('admin.typeEmail', { email: user.email })}</span>
          <input className="input" dir="ltr" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </label>
        {remove.error && <p className="danger-text">{remove.error.message}</p>}
        <div className="form-foot">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-danger" disabled={!matches || remove.isPending}>
            {t('admin.deleteForever')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Open or close sign-ups for the whole site. Takes effect at once, no restart needed. */
function SignupSwitch() {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: api.adminSettings })
  // Flip at once; go back to the server's value if saving fails.
  const [chosen, setChosen] = useState<boolean | null>(null)
  const save = useMutation({
    mutationFn: (allow_signup: boolean) => api.adminSaveSettings({ allow_signup }),
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'settings'], data)
      setChosen(null)
      void qc.invalidateQueries({ queryKey: ['health'] })
    },
    onError: () => setChosen(null),
  })
  const open = chosen ?? settings.data?.allow_signup

  return (
    <section className="panel panel-pad admin-signup">
      <div>
        <strong>{t('admin.signups')}</strong>
        <p className="faint help">{t(open ? 'admin.signupsOpen' : 'admin.signupsClosed')}</p>
        {save.error && <p className="danger-text">{save.error.message}</p>}
      </div>
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          checked={!!open}
          disabled={settings.isPending}
          onChange={(e) => {
            setChosen(e.target.checked)
            save.mutate(e.target.checked)
          }}
        />
        <span>{t(open ? 'admin.on' : 'admin.off')}</span>
      </label>
    </section>
  )
}
