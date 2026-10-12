import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { api } from './api'
import { detachPush } from './push'
import { wipeDevice } from './wipe'

/** Sign out on this device: stop its reminders, end the session and forget the cached data.
 * Whatever goes wrong on the way (no signal), the data is still removed from this device. */
export function useSignOut() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return async () => {
    try {
      await detachPush()
      await api.logout()
    } catch {
      /* offline: the session ends on its own; the device must still be cleaned */
    } finally {
      wipeDevice(qc)
      qc.setQueryData(['me'], null)
      navigate('/login')
    }
  }
}
