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
  const iosApps = discovered.flatMap(([ios]) => ios.apps)
  const androidApps = discovered.flatMap(([, android]) => android)

  const findings: Finding[] = discovered.flatMap(([ios]) => ios.findings)

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

  // The same domain is often declared by several targets (app + widget, prod + dev
  // flavours). Fetch each domain once, but evaluate the rules for every (app, domain)
  // pair — a second target missing from the AASA is exactly the false clean this tool
  // exists to prevent. Domain-level findings that come out identical are deduped below.
  {
    const allDomains = [...new Set(iosApps.flatMap((a) => a.domains))]
    for (const domain of allDomains.filter(isWildcardDomain)) {
      const declaringApp = iosApps.find((a) => a.domains.includes(domain))
      if (declaringApp) findings.push(wildcardFinding(domain, declaringApp.entitlementsPath))
      ios.domains.add(domain)
    }
    const fetchable = allDomains.filter((d) => !isWildcardDomain(d))
    const results = await mapLimit(fetchable, FETCH_CONCURRENCY, (d) => source.aasa(d))
    const fetched = new Map(fetchable.map((d, i) => [d, results[i]]))
    for (const app of iosApps) {
      for (const domain of app.domains) {
        const res = fetched.get(domain)
        if (!res) continue
        ios.domains.add(domain)
        const { findings: domainFindings, aasa } = checkIosDomain(app, domain, res)
        findings.push(...domainFindings)
        if (aasa && !ios.paths.has(domain)) ios.paths.set(domain, aasaPaths(aasa))
      }
    }
  }

  {
    for (const app of androidApps) findings.push(...checkAndroidUnresolved(app))

    const entries = androidApps.flatMap((app) => app.hosts.map((h) => ({ app, h })))
    const seenWildcards = new Set<string>()
    for (const { app, h } of entries) {
      if (!isWildcardDomain(h.host) || seenWildcards.has(h.host)) continue
      seenWildcards.add(h.host)
      android.domains.add(h.host)
      findings.push(wildcardFinding(h.host, app.manifestPath))
    }

    // an unverified host is never checked by the system, so there is nothing to fetch —
    // but fetch once per host if ANY declaring app verifies it, whichever app came first
    const checkable = entries.filter(({ h }) => !isWildcardDomain(h.host))
    const hostsToFetch = [
      ...new Set(checkable.filter(({ h }) => h.autoVerify).map(({ h }) => h.host)),
    ]
    const results = await mapLimit(hostsToFetch, FETCH_CONCURRENCY, (host) =>
      source.assetlinks(host),
    )
    const fetched = new Map(hostsToFetch.map((host, i) => [host, results[i]]))
    for (const { app, h } of checkable) {
      android.domains.add(h.host)
      if (h.paths.length > 0) {
        // every declaring app's paths count toward the cross-platform comparison
        android.paths.set(h.host, [...new Set([...(android.paths.get(h.host) ?? []), ...h.paths])])
      }
      const res = (h.autoVerify ? fetched.get(h.host) : null) ?? { url: '', ok: false, redirected: false }
      findings.push(...checkAndroidHost(app, h, res, { sha256 }))
    }
  }

  // per-(app, domain) evaluation makes domain-level findings repeat verbatim — keep one
  {
    const seen = new Set<string>()
    const deduped = findings.filter((f) => {
      const key = [f.severity, f.rule, f.domain ?? '', f.message, f.source ?? ''].join('\u0000')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    findings.length = 0
    findings.push(...deduped)
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
