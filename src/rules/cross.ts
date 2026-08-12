import type { Finding } from '../types.js'

export interface PlatformView {
  domains: Set<string>
  /** Declared path patterns per domain, already flattened to strings */
  paths: Map<string, string[]>
}

/**
 * Android declares prefixes and patterns; AASA declares glob-ish paths. Normalising both
 * to a lowercase glob makes the common cases comparable without pretending the two
 * matching engines are equivalent.
 */
function normalizePath(path: string): string {
  return path
    .trim()
    .toLowerCase()
    .replace(/^not\s+/, '!')
    // `.*` is the pathPattern spelling of a wildcard
    .replace(/\.\*/g, '*')
    .replace(/\*+$/, '*')
    // `/item/*` and the prefix form `/item*` describe the same subtree
    .replace(/\/\*$/, '*')
    .replace(/\/$/, '')
}

function normalizeSet(paths: string[]): Set<string> {
  return new Set(paths.map(normalizePath).filter(Boolean))
}

/**
 * The reason this tool exists: existing validators look at one platform, so a domain
 * that works on iOS and silently fails on Android goes unnoticed.
 */
export function checkCrossPlatform(ios: PlatformView, android: PlatformView): Finding[] {
  const findings: Finding[] = []

  // A platform with no declarations at all is a single-platform repo, not a gap
  if (ios.domains.size === 0 || android.domains.size === 0) return findings

  for (const domain of ios.domains) {
    if (android.domains.has(domain)) continue
    findings.push({
      severity: 'warn',
      rule: 'platform-domain-gap',
      domain,
      message: 'Declared on iOS but not on Android',
      detail: 'The same link opens the app on iOS and the browser on Android',
    })
  }

  for (const domain of android.domains) {
    if (ios.domains.has(domain)) continue
    findings.push({
      severity: 'warn',
      rule: 'platform-domain-gap',
      domain,
      message: 'Declared on Android but not on iOS',
      detail: 'The same link opens the app on Android and the browser on iOS',
    })
  }

  for (const domain of ios.domains) {
    if (!android.domains.has(domain)) continue
    const iosPaths = normalizeSet(ios.paths.get(domain) ?? [])
    const androidPaths = normalizeSet(android.paths.get(domain) ?? [])
    // Either side declaring nothing means "all paths", which is not a mismatch to report
    if (iosPaths.size === 0 || androidPaths.size === 0) continue

    const onlyIos = [...iosPaths].filter((p) => !androidPaths.has(p))
    const onlyAndroid = [...androidPaths].filter((p) => !iosPaths.has(p))
    if (onlyIos.length === 0 && onlyAndroid.length === 0) continue

    findings.push({
      severity: 'info',
      rule: 'platform-path-gap',
      domain,
      message: 'The declared path sets differ between platforms',
      detail: [
        onlyIos.length ? `iOS only: ${onlyIos.join(', ')}` : '',
        onlyAndroid.length ? `Android only: ${onlyAndroid.join(', ')}` : '',
        'Path matching differs between the two systems, so review this by hand.',
      ]
        .filter(Boolean)
        .join(' · '),
    })
  }

  return findings
}
