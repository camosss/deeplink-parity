import { readFile } from 'node:fs/promises'
import type { Finding } from '../types.js'
import { displayPath, walk } from './walk.js'

const CONFIG_FILES = new Set(['app.json', 'app.config.js', 'app.config.ts', 'app.config.json'])

/**
 * Expo projects declare deep links in the Expo config rather than in the native files,
 * and `expo prebuild` generates `ios/` and `android/` at build time — they are usually
 * gitignored. Scanning such a checkout finds nothing, which would read as "all clear".
 *
 * Static JSON config is parsed directly. A JavaScript config is not evaluated: doing so
 * means executing arbitrary code from the repository being inspected, which a checker
 * should not do. Those projects are pointed at `expo prebuild` instead.
 */
export async function detectExpo(root: string, foundNative: boolean): Promise<Finding[]> {
  if (foundNative) return []

  const configs = await walk(root, (n) => CONFIG_FILES.has(n))
  if (configs.length === 0) return []

  const findings: Finding[] = []

  for (const path of configs) {
    const source = await readFile(path, 'utf8')
    if (!/associatedDomains|intentFilters/.test(source)) continue

    const isStatic = path.endsWith('.json')
    const domains = isStatic ? staticDomains(source) : []

    findings.push({
      severity: 'warn',
      rule: 'expo-config-only',
      message: 'Deep links are declared in the Expo config and no native project was found',
      detail: domains.length
        ? `Declared: ${domains.join(', ')}. Run \`npx expo prebuild\` and scan again to verify them.`
        : 'Run `npx expo prebuild` to generate ios/ and android/, then scan again. A JavaScript config is not evaluated.',
      source: displayPath(path),
    })
  }

  return findings
}

/** Pull `applinks:` entries out of a static Expo config without executing it. */
function staticDomains(source: string): string[] {
  const domains = new Set<string>()
  for (const m of source.matchAll(/"applinks:([^"]+)"/g)) domains.add(m[1].split('?')[0])
  return [...domains]
}
