import type { Finding } from '../types.js'
import type { ExtractedRoutes } from './extract.js'

/** Above this many gaps per direction, one grouped finding replaces per-path noise. */
const GROUP_THRESHOLD = 20

const DYNAMIC_NOTE =
  'Routes handled dynamically (prefix or path-component matching) never appear in a route table — confirm before acting.'

function gapFindings(
  present: ExtractedRoutes,
  absent: ExtractedRoutes,
  gaps: string[],
): Finding[] {
  const presentName = present.platform === 'ios' ? 'iOS' : 'Android'
  const absentName = absent.platform === 'ios' ? 'iOS' : 'Android'

  if (gaps.length > GROUP_THRESHOLD) {
    return [
      {
        severity: 'warn',
        rule: 'route-gap',
        message: `${gaps.length} routes are in the ${presentName} route table but not ${absentName}'s`,
        detail: `${gaps.join(', ')} · ${DYNAMIC_NOTE}`,
        source: present.files[0],
      },
    ]
  }

  return gaps.map((path) => ({
    severity: 'warn' as const,
    rule: 'route-gap',
    message: `${path} is in the ${presentName} route table but not ${absentName}'s`,
    detail: `A ${path} link navigates on ${presentName} and goes nowhere on ${absentName}. ${DYNAMIC_NOTE}`,
    source: present.files[0],
  }))
}

/**
 * The comparison only runs when both tables extracted successfully — diffing a full
 * table against a failed or missing one would manufacture gaps that do not exist.
 */
export function compareRoutes(ios?: ExtractedRoutes, android?: ExtractedRoutes): Finding[] {
  if (!ios && !android) return []

  if (!ios || !android) {
    const present = (ios ?? android) as ExtractedRoutes
    return [
      {
        severity: 'info',
        rule: 'route-single-platform',
        message: `Routes are configured for ${present.platform === 'ios' ? 'iOS' : 'Android'} only`,
        detail: `${present.paths.length} route(s) extracted. Configure both platforms to compare them.`,
        source: present.files[0],
      },
    ]
  }

  const iosSet = new Set(ios.paths)
  const androidSet = new Set(android.paths)
  return [
    ...gapFindings(ios, android, ios.paths.filter((p) => !androidSet.has(p))),
    ...gapFindings(android, ios, android.paths.filter((p) => !iosSet.has(p))),
  ]
}
