import { formatNumber } from '../lib/format'
import { t } from '../lib/i18n'
import { clearFailed, syncNow, useSyncState } from '../lib/offline'

/** Small pill that says when you're offline, how many changes are waiting, and when they're sent. */
export default function SyncStatus() {
  const { online, pending, syncing, failed } = useSyncState()

  if (failed) {
    return (
      <div className="sync-pill sync-failed" role="status">
        <span>{t('sync.failed', { n: formatNumber(failed) })}</span>
        <button className="link-quiet" onClick={clearFailed}>
          {t('sync.dismiss')}
        </button>
      </div>
    )
  }
  if (online && !pending) return null

  return (
    <div className={`sync-pill ${online ? '' : 'sync-offline'}`} role="status">
      <i className="sync-dot" aria-hidden="true" />
      <span>
        {!online ? t('sync.offline') : syncing ? t('sync.syncing') : t('sync.waitingTitle')}
        {pending > 0 && <> · {pending === 1 ? t('sync.waitingOne') : t('sync.waiting', { n: formatNumber(pending) })}</>}
      </span>
      {online && !syncing && pending > 0 && (
        <button className="link-quiet" onClick={() => void syncNow()}>
          {t('sync.retry')}
        </button>
      )}
    </div>
  )
}
