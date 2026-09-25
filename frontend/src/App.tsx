import { Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/Layout'
import { useMe } from './lib/hooks'
import { useLang } from './lib/i18n'
import AuthPage from './pages/AuthPage'
import Courses from './pages/Courses'
import Deadlines from './pages/Deadlines'
import Grades from './pages/Grades'
import Schedule from './pages/Schedule'
import Settings from './pages/Settings'
import Terms from './pages/Terms'
import Today from './pages/Today'

export default function App() {
  const { data: user, isPending } = useMe()
  // Re-mount everything when the language changes so every string and date re-renders.
  const lang = useLang()

  if (isPending) return <div className="boot" aria-busy="true" />

  if (!user) {
    return (
      <Routes key={lang}>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Routes key={lang}>
      <Route element={<Layout user={user} />}>
        <Route index element={<Today />} />
        <Route path="schedule" element={<Schedule />} />
        <Route path="courses" element={<Courses />} />
        <Route path="deadlines" element={<Deadlines />} />
        <Route path="grades" element={<Grades />} />
        <Route path="terms" element={<Terms />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
