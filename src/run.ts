import { discoverAndroid } from './discover/android.js'
import { discoverIos } from './discover/ios.js'
import type { WellKnownSource } from './fetch/wellKnown.js'
import { checkAndroidHost, checkAndroidUnresolved } from './rules/android.js'
import { checkCrossPlatform, type PlatformView } from './rules/cross.js'
import { aasaPaths, checkIosDomain } from './rules/ios.js'
import { isWildcardDomain, wildcardFinding } from './rules/wildcard.js'
import type { AndroidApp, Finding, IosApp } from './types.js'

export interface RunOptions {
  root: string
  source: WellKnownSource
  /** SHA256 signing fingerprint to look for in assetlinks.json */
  sha256?: string
}

export interface RunResult {
  iosApps: IosApp[]
  androidApps: AndroidApp[]
  domains: string[]
  findings: Finding[]
}

function emptyView(): PlatformView {
  return { domains: new Set(), paths: new Map() }
}

export async function run({ root, source, sha256 }: RunOptions): Promise<RunResult> {
  const [iosApps, androidApps] = await Promise.all([discoverIos(root), discoverAndroid(root)])

  const findings: Finding[] = []
  const ios = emptyView()
  const android = emptyView()

  for (const app of iosApps) {
    // the same domain can be declared by several targets; fetch it once
    const fresh = app.domains.filter((d) => !ios.domains.has(d))
    fresh.forEach((d) => ios.domains.add(d))

    const wildcards = fresh.filter(isWildcardDomain)
    wildcards.forEach((d) => findings.push(wildcardFinding(d, app.entitlementsPath)))

    const pending = fresh.filter((d) => !isWildcardDomain(d))
    const results = await Promise.all(pending.map((d) => source.aasa(d)))
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
    const results = await Promise.all(
      // an unverified host is never checked by the system, so there is nothing to fetch
      pending.map((h) => (h.autoVerify ? source.assetlinks(h.host) : Promise.resolve(null))),
    )
    pending.forEach((entry, i) => {
      const res = results[i] ?? { url: '', ok: false, redirected: false }
      findings.push(...checkAndroidHost(app, entry, res, { sha256 }))
    })
  }

  findings.push(...checkCrossPlatform(ios, android))

  return {
    iosApps,
    androidApps,
    domains: [...new Set([...ios.domains, ...android.domains])],
    findings,
  }
}
