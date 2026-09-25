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

interface Props {
  value: string
  onChange: (zone: string) => void
}

/** Pick the time zone reminders are sent in, with a nudge when this phone is somewhere else. */
export default function TimeZoneField({ value, onChange }: Props) {
  const device = browserTimeZone()
  const common = [...new Set([value, device, ...COMMON])]
  const others = allZones().filter((z) => !common.includes(z))

  return (
    <div className="field">
      <label className="field">
        <span>{t('notify.timezone')}</span>
        <select className="select" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)}>
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
        <small className="faint">{t('notify.zoneHint')}</small>
      </label>
      {device !== value && (
        <p className="zone-differs">
          {t('notify.zoneDiffers', { device: zoneLabel(device), zone: zoneLabel(value) })}{' '}
          <button type="button" className="link-quiet" onClick={() => onChange(device)}>
            {t('notify.useDevice', { device: zoneLabel(device) })}
          </button>
        </p>
      )}
    </div>
  )
}
