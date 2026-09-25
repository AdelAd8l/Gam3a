import { t } from '../lib/i18n'
import { browserTimeZone } from '../lib/push'

// The zones people using this app are most likely in, shown first.
const COMMON = [
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Bahrain',
  'Asia/Muscat',
  'Asia/Amman',
  'Asia/Beirut',
  'Africa/Casablanca',
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
]

function allZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return COMMON
  }
}

/** "Dubai (UTC+4)" — the city and today's offset (it changes with daylight saving). */
function zoneLabel(zone: string) {
  let offset = ''
  try {
    offset =
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')
        ?.value.replace('GMT', 'UTC') ?? ''
  } catch {
    /* unknown zone: just the name */
  }
  const city = zone.split('/').pop()!.replace(/_/g, ' ')
  return offset ? `${city} (${offset === 'UTC' ? 'UTC+0' : offset})` : city
}

const AUTO = 'auto'

interface Props {
  value: string
  auto: boolean
  onChange: (change: { timezone: string; timezone_auto: boolean }) => void
}

/** Automatic (follows the phone that gets the reminders) or a zone picked by hand. */
export default function TimeZoneField({ value, auto, onChange }: Props) {
  const device = browserTimeZone()
  const common = [...new Set([value, device, ...COMMON])]
  const others = allZones().filter((z) => !common.includes(z))

  return (
    <div className="field">
      <label className="field">
        <span>{t('notify.timezone')}</span>
        <select
          className="select"
          value={auto ? AUTO : value}
          onChange={(e) =>
            e.target.value === AUTO
              ? onChange({ timezone: device, timezone_auto: true })
              : onChange({ timezone: e.target.value, timezone_auto: false })
          }
        >
          <option value={AUTO}>{t('notify.zoneAuto', { zone: zoneLabel(auto ? value : device) })}</option>
          {common.map((z) => (
            <option key={z} value={z}>
              {zoneLabel(z)}
            </option>
          ))}
          <optgroup label={t('notify.otherZones')}>
            {others.map((z) => (
              <option key={z} value={z}>
                {zoneLabel(z)}
              </option>
            ))}
          </optgroup>
        </select>
        <small className="faint">{t(auto ? 'notify.zoneAutoHint' : 'notify.zoneHint')}</small>
      </label>
      {!auto && device !== value && (
        <p className="zone-differs">
          {t('notify.zoneDiffers', { device: zoneLabel(device), zone: zoneLabel(value) })}{' '}
          <button type="button" className="link-quiet" onClick={() => onChange({ timezone: device, timezone_auto: false })}>
            {t('notify.useDevice', { device: zoneLabel(device) })}
          </button>
        </p>
      )}
    </div>
  )
}
