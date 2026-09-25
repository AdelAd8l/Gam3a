import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { api } from './api'
import { clearOutbox } from './offline'
import { detachPush } from './push'

/** Sign out on this device: stop its reminders, end the session and forget the cached data. */
export function useSignOut() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return async () => {
    await detachPush()
    await api.logout()
    clearOutbox()
    qc.clear()
    qc.setQueryData(['me'], null)
    navigate('/login')
  }
}
