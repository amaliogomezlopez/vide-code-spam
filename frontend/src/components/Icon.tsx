import type { SVGProps } from 'react'

/**
 * Inline SVG icons. No external dependency.
 * All icons inherit `currentColor` and use a 24×24 viewBox with 2px strokes
 * (Lucide-compatible geometry) so they stay visually consistent.
 */
export type IconName =
  | 'settings'
  | 'close'
  | 'mic'
  | 'micOff'
  | 'refresh'
  | 'plus'
  | 'trash'
  | 'play'
  | 'stop'
  | 'folder'
  | 'terminal'
  | 'chevronDown'
  | 'alertCircle'
  | 'info'
  | 'keyboard'
  | 'palette'
  | 'cpu'
  | 'windowMin'
  | 'windowMax'
  | 'windowClose'
  | 'sparkles'

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export default function Icon({ name, size = 16, ...rest }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    className: `icon ${rest.className ?? ''}`.trim(),
    ...rest,
  }

  switch (name) {
    case 'settings':
      return (
        <svg {...common}>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )
    case 'close':
      return (
        <svg {...common}>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      )
    case 'mic':
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
          <path
            d="M19 10a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-3.08A7 7 0 0 0 19 10z"
            fill="currentColor"
          />
        </svg>
      )
    case 'micOff':
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M12 2a3 3 0 0 0-3 3v.93l5.7 5.7A2.98 2.98 0 0 0 15 9V5a3 3 0 0 0-3-3z" />
          <path d="M19 10c0 .5-.07.99-.18 1.46l1.55 1.55A8.93 8.93 0 0 0 21 10a1 1 0 1 0-2 0z" />
          <path d="M9 9v.93l5.97 5.97A5 5 0 0 1 7 10a1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-3.08a6.9 6.9 0 0 0 2.39-.7l1.78 1.78A8.96 8.96 0 0 1 13 16.92V17a7 7 0 0 0 6-6.92" />
          <path d="M2.7 2.3a1 1 0 0 0-1.4 1.4l18 18a1 1 0 0 0 1.4-1.4z" />
        </svg>
      )
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      )
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      )
    case 'trash':
      return (
        <svg {...common}>
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
        </svg>
      )
    case 'play':
      return (
        <svg {...common}>
          <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'stop':
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <rect x="5" y="5" width="14" height="14" rx="2" />
        </svg>
      )
    case 'folder':
      return (
        <svg {...common}>
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />
        </svg>
      )
    case 'terminal':
      return (
        <svg {...common}>
          <path d="m4 17 6-6-6-6" />
          <path d="M12 19h8" />
        </svg>
      )
    case 'chevronDown':
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      )
    case 'alertCircle':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      )
    case 'info':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      )
    case 'keyboard':
      return (
        <svg {...common}>
          <path d="M10 13H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-6" />
          <path d="M14 10h.01M18 10h.01M8 10H7M6 14h12a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2z" />
        </svg>
      )
    case 'palette':
      return (
        <svg {...common}>
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
          <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
          <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
          <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
        </svg>
      )
    case 'cpu':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" />
        </svg>
      )
    case 'windowMin':
      return (
        <svg {...common} strokeWidth={1.5}>
          <path d="M5 12h14" />
        </svg>
      )
    case 'windowMax':
      return (
        <svg {...common} strokeWidth={1.5}>
          <rect x="5" y="6" width="14" height="12" rx="1.5" />
        </svg>
      )
    case 'windowClose':
      return (
        <svg {...common} strokeWidth={1.5}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      )
    case 'sparkles':
      return (
        <svg {...common}>
          <path d="M12 3v4M10 5h4" strokeLinecap="round" />
          <path d="m5 8 1.5 3L9 12.5 6.5 14 5 17l-1.5-3L1 12.5 3.5 11z" />
          <path d="M18 13v3M16.5 14.5h3" strokeLinecap="round" />
          <path d="m17 4 .8 2L20 6.8l-2 .8-.8 2-.8-2L14 6.8l2-.8z" />
        </svg>
      )
    default:
      return null
  }
}
