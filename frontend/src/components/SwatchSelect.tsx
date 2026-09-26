import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Each option's color (course, account or category); none for "All …". */
  colorOf?: (value: string) => string | undefined
  /** "select" or "select select-auto", as for a plain select. */
  className?: string
  'aria-label'?: string
  /** The choices, written as <option value="…">label</option>. */
  children: ReactNode
}

interface Choice {
  value: string
  label: ReactNode
}

const LIST_MAX = 280 // px, the list's greatest height

/** A dropdown whose list shows each course's, account's or category's color. A phone's own
 * select list can only hold plain text, so this one is drawn by the app. */
export default function SwatchSelect({ value, onChange, colorOf, className = 'select', children, ...rest }: Props) {
  const choices: Choice[] = Children.toArray(children)
    .filter(isValidElement)
    .map((o) => {
      const props = o.props as { value?: string | number; children?: ReactNode }
      return { value: String(props.value ?? ''), label: props.children }
    })
  const selected = Math.max(
    0,
    choices.findIndex((c) => c.value === value),
  )
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(selected)
  const [place, setPlace] = useState<CSSProperties>({})
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()
  const color = colorOf?.(choices[selected]?.value ?? '')

  function show() {
    const r = button.current!.getBoundingClientRect()
    const rtl = getComputedStyle(button.current!).direction === 'rtl'
    const below = window.innerHeight - r.bottom
    const up = below < Math.min(LIST_MAX, 44 * choices.length + 10) && r.top > below
    // Fixed to the screen, so a dialog's scrolling edge can't cut it off.
    setPlace({
      minWidth: r.width,
      maxWidth: (rtl ? r.right : window.innerWidth - r.left) - 8,
      maxHeight: Math.min(LIST_MAX, (up ? r.top : below) - 12),
      ...(rtl ? { right: window.innerWidth - r.right } : { left: r.left }),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    })
    setActive(selected)
    setOpen(true)
  }

  function choose(i: number) {
    setOpen(false)
    button.current?.focus()
    if (choices[i] && choices[i].value !== value) onChange(choices[i].value)
  }

  // Close when tapping elsewhere, or when the page scrolls or resizes under it.
  useEffect(() => {
    if (!open) return
    const away = (e: Event) => {
      const target = e.target as Node
      if (!button.current?.contains(target) && !list.current?.contains(target)) setOpen(false)
    }
    const moved = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) setOpen(false)
    }
    const shut = () => setOpen(false)
    document.addEventListener('pointerdown', away)
    window.addEventListener('scroll', moved, true)
    window.addEventListener('resize', shut)
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('scroll', moved, true)
      window.removeEventListener('resize', shut)
    }
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, id])

  function onKey(e: KeyboardEvent) {
    const last = choices.length - 1
    const move = (i: number) => {
      e.preventDefault()
      if (open) setActive(Math.min(last, Math.max(0, i)))
      else show()
    }
    switch (e.key) {
      case 'ArrowDown':
        return move(active + 1)
      case 'ArrowUp':
        return move(active - 1)
      case 'Home':
        return move(0)
      case 'End':
        return move(last)
      case 'Enter':
      case ' ':
        e.preventDefault()
        return open ? choose(active) : show()
      case 'Escape':
        if (open) {
          e.preventDefault() // close the list, not the dialog around it
          e.stopPropagation()
          setOpen(false)
        }
        return
      case 'Tab':
        setOpen(false)
    }
  }

  return (
    <span className={`swatch-select${className.includes('select-auto') ? ' is-auto' : ''}`}>
      <button
        ref={button}
        type="button"
        className={`${className} swatch-button`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        {...rest}
      >
        {color && <span className="swatch" style={{ background: color }} />}
        <span className="swatch-label" dir="auto">{choices[selected]?.label}</span>
      </button>
      {open && (
        <ul ref={list} id={`${id}-list`} role="listbox" className="swatch-list" style={place}>
          {choices.map((c, i) => {
            const dot = colorOf?.(c.value)
            return (
              <li
                key={c.value}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === selected}
                className={i === active ? 'is-active' : undefined}
                onPointerEnter={() => setActive(i)}
                onClick={(e) => {
                  e.preventDefault() // inside a <label>: don't let the tap reach the button again
                  choose(i)
                }}
              >
                <span className="swatch" style={dot ? { background: dot } : { visibility: 'hidden' }} />
                <span className="swatch-label" dir="auto">{c.label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </span>
  )
}
