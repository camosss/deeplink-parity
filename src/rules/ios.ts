import { appIdMatches, parseAasa } from '../parse/aasa.js'
import type { Aasa, FetchResult, Finding, IosApp } from '../types.js'

export interface IosCheckResult {
  findings: Finding[]
  /** Returned so the cross-platform pass can reuse it instead of re-parsing. */
  aasa?: Aasa
}

/**
 * Per-domain iOS checks. Each stage stops the chain when a later check could not
 * possibly be meaningful — an unreachable AASA says nothing about its appIDs.
 */
export function checkIosDomain(app: IosApp, domain: string, res: FetchResult): IosCheckResult {
  const findings: Finding[] = []
  const source = res.url

  if (res.error) {
    findings.push({
      severity: 'error',
      rule: 'aasa-unreachable',
      domain,
      message: `Could not fetch the AASA file — ${res.error}`,
      detail: 'Universal Links fall through to the browser',
      source,
    })
    return { findings }
  }

  if (res.redirected) {
    findings.push({
      severity: 'error',
      rule: 'aasa-redirect',
      domain,
      message: `AASA responded with ${res.status}${res.location ? ` → ${res.location}` : ''}`,
      detail: 'iOS does not follow redirects when fetching an AASA file',
      source,
    })
    return { findings }
  }

  if (!res.ok) {
    findings.push({
      severity: 'error',
      rule: 'aasa-unreachable',
      domain,
      message: `AASA responded with ${res.status}`,
      detail: 'Universal Links fall through to the browser',
      source,
    })
    return { findings }
  }

  const { aasa, error } = parseAasa(res.body ?? '')
  if (!aasa) {
    findings.push({
      severity: 'error',
      rule: 'aasa-invalid',
      domain,
      message: `Could not parse the AASA file — ${error}`,
      source,
    })
    return { findings }
  }

  if (res.contentType && !res.contentType.includes('application/json')) {
    findings.push({
      severity: 'warn',
      rule: 'aasa-content-type',
      domain,
      message: `content-type is ${res.contentType}`,
      detail: 'application/json is recommended',
      source,
    })
  }

  const declaredAppIds = aasa.details.flatMap((d) => d.appIds)

  if (declaredAppIds.length === 0) {
    findings.push({
      severity: 'error',
      rule: 'aasa-no-appids',
      domain,
      message: 'The AASA file declares no appIDs',
      source,
    })
  } else if (app.teamId && app.bundleId) {
    const matched = declaredAppIds.some((id) => appIdMatches(id, app.teamId!, app.bundleId!))
    if (!matched) {
      findings.push({
        severity: 'error',
        rule: 'aasa-appid-missing',
        subject: `${app.teamId}.${app.bundleId}`,
        domain,
        message: `The AASA file does not list ${app.teamId}.${app.bundleId}`,
        detail: `Declared appIDs: ${declaredAppIds.join(', ')}`,
        source,
      })
    }
  } else {
    findings.push({
      severity: 'info',
      rule: 'appid-unknown',
      domain,
      message: 'Skipped the appID check — could not determine the Team ID or bundle ID',
      detail: 'The pbxproj value may be an xcconfig variable',
      source: app.entitlementsPath,
    })
  }

  const allEmpty =
    aasa.details.length > 0 &&
    aasa.details.every((d) => (d.paths?.length ?? 0) === 0 && (d.components?.length ?? 0) === 0)
  if (allEmpty) {
    findings.push({
      severity: 'info',
      rule: 'aasa-no-paths',
      domain,
      message: 'The AASA file declares no paths or components',
      detail: 'Depending on the format this opens every path in the app, or none of them',
      source,
    })
  }

  return { findings, aasa }
}

/** Flatten the legacy `paths` and current `components` forms into comparable strings. */
export function aasaPaths(aasa: Aasa): string[] {
  const paths = new Set<string>()
  for (const detail of aasa.details) {
    for (const path of detail.paths ?? []) paths.add(path)
    for (const component of detail.components ?? []) {
      if (!component || typeof component !== 'object') continue
      const value = (component as Record<string, unknown>)['/']
      if (typeof value === 'string') paths.add(value)
    }
  }
  return [...paths]
}
