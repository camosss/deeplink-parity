import { readFile } from 'node:fs/promises'

import plist from 'plist'
import type { Finding, IosApp } from '../types.js'
import { displayPath, walk } from './walk.js'

/**
 * Associated Domains entries look like `applinks:example.com`. A domain may carry
 * query-parameter options (`?mode=developer`) which are not part of the host.
 */
function parseAssociatedDomains(entries: unknown): string[] {
  if (!Array.isArray(entries)) return []
  const domains: string[] = []
  for (const raw of entries) {
    if (typeof raw !== 'string') continue
    if (!raw.startsWith('applinks:')) continue
    const host = raw.slice('applinks:'.length).split('?')[0].trim()
    if (host && !domains.includes(host)) domains.push(host)
  }
  return domains
}

/**
 * Build settings can be literals or `$(VARIABLE)` references. We only take literals —
 * a reference means the real value lives in an xcconfig we are not resolving yet.
 */
function literalSetting(block: string, key: string): string | undefined {
  const m = block.match(new RegExp(`\\n\\s*${key}\\s*=\\s*"?([^";\\n]+)"?;`))
  const value = m?.[1]?.trim()
  if (!value || value.includes('$(') || value === '""') return undefined
  return value
}

export interface TargetSigning {
  bundleId?: string
  teamId?: string
}

/**
 * A project has one bundle id per target, not one per project. The entitlements path
 * and the bundle id live in the same `buildSettings` block, so pairing them there
 * avoids attributing the widget's identifier to the app.
 */
function signingByEntitlements(pbxproj: string): Map<string, TargetSigning> {
  const map = new Map<string, TargetSigning>()
  for (const m of pbxproj.matchAll(/buildSettings = \{([\s\S]*?)\n\s*\};/g)) {
    const block = m[1]
    const entitlements = literalSetting(block, 'CODE_SIGN_ENTITLEMENTS')
    if (!entitlements) continue
    const existing = map.get(entitlements) ?? {}
    map.set(entitlements, {
      bundleId: existing.bundleId ?? literalSetting(block, 'PRODUCT_BUNDLE_IDENTIFIER'),
      teamId: existing.teamId ?? literalSetting(block, 'DEVELOPMENT_TEAM'),
    })
  }
  return map
}

/**
 * Pick the target whose recorded entitlements path is the longest tail of this file's
 * path. Longest wins so that `Widget/Widget.entitlements` never matches the app when
 * `App/App.entitlements` is also on file.
 */
function matchSigning(path: string, signing: Map<string, TargetSigning>): TargetSigning {
  let best: TargetSigning = {}
  let bestLength = -1
  for (const [key, value] of signing) {
    const tail = key.startsWith('/') ? key : `/${key}`
    if (path.endsWith(tail) && key.length > bestLength) {
      best = value
      bestLength = key.length
    }
  }
  return best
}

export interface IosDiscovery {
  apps: IosApp[]
  findings: Finding[]
}

export async function discoverIos(root: string): Promise<IosDiscovery> {
  const findings: Finding[] = []
  const entitlementFiles = await walk(root, (n) => n.endsWith('.entitlements'))
  if (entitlementFiles.length === 0) return { apps: [], findings }

  const pbxprojPaths = await walk(root, (n) => n === 'project.pbxproj')
  const signing = new Map<string, TargetSigning>()
  for (const path of pbxprojPaths) {
    for (const [k, v] of signingByEntitlements(await readFile(path, 'utf8'))) {
      if (!signing.has(k)) signing.set(k, v)
    }
  }

  const apps: IosApp[] = []
  for (const path of entitlementFiles) {
    let parsed: unknown
    try {
      parsed = plist.parse(await readFile(path, 'utf8'))
    } catch (err) {
      // a file that fails to parse would read as "no declaration" — silent narrowing
      findings.push({
        severity: 'warn',
        rule: 'entitlements-unreadable',
        message: `Could not parse ${path} — ${err instanceof Error ? err.message : String(err)}`,
        detail: 'If this file declares applinks:, its domains were NOT checked this run.',
        source: path,
      })
      continue
    }
    const dict = parsed as Record<string, unknown>
    const domains = parseAssociatedDomains(dict['com.apple.developer.associated-domains'])
    if (domains.length === 0) continue

    // pbxproj records the entitlements path relative to SOURCE_ROOT, which is not
    // necessarily the directory being scanned — match on the tail so that pointing at
    // a repository root or at a subdirectory both resolve the same target.
    const target = matchSigning(path, signing)

    apps.push({
      entitlementsPath: displayPath(path),
      domains,
      bundleId: target.bundleId,
      teamId: target.teamId,
    })
  }
  return { apps, findings }
}
