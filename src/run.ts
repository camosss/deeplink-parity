import { discoverAndroid } from './discover/android.js'
import { detectExpo } from './discover/expo.js'
import { discoverIos } from './discover/ios.js'
import { FETCH_CONCURRENCY, mapLimit } from './fetch/pool.js'
import type { WellKnownSource } from './fetch/wellKnown.js'
import { checkAndroidHost, checkAndroidUnresolved } from './rules/android.js'
import { checkCrossPlatform, type PlatformView } from './rules/cross.js'
import { aasaPaths, checkIosDomain } from './rules/ios.js'
import { isWildcardDomain, wildcardFinding } from './rules/wildcard.js'
import { compareRoutes } from './routes/check.js'
import type { RoutesConfig } from './routes/config.js'
import { extractRoutes, type ExtractedRoutes } from './routes/extract.js'
import type { AndroidApp, Finding, IosApp } from './types.js'

export interface RunOptions {
  /** One or more checkout roots. Two repositories can be passed as two paths. */
  roots: string[]
  source: WellKnownSource
  /** SHA256 signing fingerprint to look for in assetlinks.json */
  sha256?: string
  /** Route-table comparison, active only when a config declares it */
  routes?: RoutesConfig
  /** Called once with the number of distinct domains about to be checked */
  onDiscovered?: (count: number) => void
}

export interface RunResult {
  iosApps: IosApp[]
  androidApps: AndroidApp[]
  domains: string[]
  routes?: { ios?: ExtractedRoutes; android?: ExtractedRoutes }
  findings: Finding[]
}

function emptyView(): PlatformView {
  return { domains: new Set(), paths: new Map() }
}

async function runRouteChecks(
  routes: RoutesConfig,
  roots: string[],
  findings: Finding[],
): Promise<RunResult['routes']> {
  const [ios, android] = await Promise.all([
    routes.ios ? extractRoutes('ios', routes.ios, roots) : undefined,
    routes.android ? extractRoutes('android', routes.android, roots) : undefined,
  ])
  findings.push(...(ios?.findings ?? []), ...(android?.findings ?? []))
  findings.push(...compareRoutes(ios?.routes, android?.routes))
  return { ios: ios?.routes, android: android?.routes }
}

export async function run({
  roots,
  source,
  sha256,
  routes,
  onDiscovered,
}: RunOptions): Promise<RunResult> {
  const discovered = await Promise.all(
    roots.map(async (root) => Promise.all([discoverIos(root), discoverAndroid(root)])),
  )
  const iosApps = discovered.flatMap(([ios]) => ios)
  const androidApps = discovered.flatMap(([, android]) => android)

  const findings: Finding[] = []

  // an Expo checkout has no native project committed; say so rather than report nothing
  if (iosApps.length === 0 && androidApps.length === 0) {
    for (const root of roots) findings.push(...(await detectExpo(root, false)))
  }

  const ios = emptyView()
  const android = emptyView()

  onDiscovered?.(
    new Set([
      ...iosApps.flatMap((a) => a.domains),
      ...androidApps.flatMap((a) => a.hosts.map((h) => h.host)),
    ]).size,
  )

  for (const app of iosApps) {
    // the same domain can be declared by several targets; fetch it once
    const fresh = app.domains.filter((d) => !ios.domains.has(d))
    fresh.forEach((d) => ios.domains.add(d))

    const wildcards = fresh.filter(isWildcardDomain)
    wildcards.forEach((d) => findings.push(wildcardFinding(d, app.entitlementsPath)))

    const pending = fresh.filter((d) => !isWildcardDomain(d))
    const results = await mapLimit(pending, FETCH_CONCURRENCY, (d) => source.aasa(d))
    pending.forEach((domain, i) => {
      const { findings: domainFindings, aasa } = checkIosDomain(app, domain, results[i])
      findings.push(...domainFindings)
      if (aasa) ios.paths.set(domain, aasaPaths(aasa))
    })
  }

  for (const app of androidApps) {
    findings.push(...checkAndroidUnresolved(app))
    const fresh = app.hosts.filter((h) => !android.domains.has(h.host))
    fresh.forEach((h) => {
      android.domains.add(h.host)
      if (h.paths.length > 0) android.paths.set(h.host, h.paths)
    })

    fresh
      .filter((h) => isWildcardDomain(h.host))
      .forEach((h) => findings.push(wildcardFinding(h.host, app.manifestPath)))

    const pending = fresh.filter((h) => !isWildcardDomain(h.host))
    // an unverified host is never checked by the system, so there is nothing to fetch
    const results = await mapLimit(pending, FETCH_CONCURRENCY, (h) =>
      h.autoVerify ? source.assetlinks(h.host) : Promise.resolve(null),
    )
    pending.forEach((entry, i) => {
      const res = results[i] ?? { url: '', ok: false, redirected: false }
      findings.push(...checkAndroidHost(app, entry, res, { sha256 }))
    })
  }

  findings.push(...checkCrossPlatform(ios, android))

  const routeTables = routes ? await runRouteChecks(routes, roots, findings) : undefined

  return {
    iosApps,
    androidApps,
    domains: [...new Set([...ios.domains, ...android.domains])],
    routes: routeTables,
    findings,
  }
}
