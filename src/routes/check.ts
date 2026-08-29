import type { Finding } from '../types.js'
import type { ExtractedRoutes } from './extract.js'

const DYNAMIC_NOTE =
  'Routes handled dynamically (prefix or path-component matching) never appear in a route table — confirm before acting.'

function gapFindings(
  present: ExtractedRoutes,
  absent: ExtractedRoutes,
  gaps: string[],
): Finding[] {
  const presentName = present.platform === 'ios' ? 'iOS' : 'Android'
  const absentName = absent.platform === 'ios' ? 'iOS' : 'Android'

  // Always one finding per path: a grouped finding keyed its baseline identity on a
  // message containing the gap COUNT, so 21→22 gaps refired everything. The reporters
  // collapse long runs visually instead.
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
