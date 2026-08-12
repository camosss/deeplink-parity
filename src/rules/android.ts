import { HANDLE_ALL_URLS, normalizeFingerprint, parseAssetlinks } from '../parse/assetlinks.js'
import type { AndroidApp, AndroidHost, FetchResult, Finding } from '../types.js'

export interface AndroidOptions {
  /** SHA256 signing fingerprint to look for, when the caller can supply one */
  sha256?: string
}

export function checkAndroidHost(
  app: AndroidApp,
  entry: AndroidHost,
  res: FetchResult,
  options: AndroidOptions,
): Finding[] {
  const findings: Finding[] = []
  const domain = entry.host
  const source = res.url

  // Only autoVerify hosts are verified by the system; the rest open a chooser by design
  if (!entry.autoVerify) {
    findings.push({
      severity: 'warn',
      rule: 'intent-filter-no-autoverify',
      domain,
      message: 'This https intent-filter has no autoVerify',
      detail: 'App Links stay unverified, so the user sees a disambiguation dialog',
      source: app.manifestPath,
    })
    return findings
  }

  if (res.error || !res.ok) {
    findings.push({
      severity: 'error',
      rule: 'assetlinks-unreachable',
      domain,
      message: res.error
        ? `Could not fetch assetlinks.json — ${res.error}`
        : `assetlinks.json responded with ${res.status}`,
      detail: 'App Link verification fails and links fall through to the browser',
      source,
    })
    return findings
  }

  const { statements, error } = parseAssetlinks(res.body ?? '')
  if (!statements) {
    findings.push({
      severity: 'error',
      rule: 'assetlinks-invalid',
      domain,
      message: `Could not parse assetlinks.json — ${error}`,
      source,
    })
    return findings
  }

  const handling = statements.filter((s) => s.relations.includes(HANDLE_ALL_URLS))
  if (handling.length === 0) {
    findings.push({
      severity: 'error',
      rule: 'assetlinks-no-statement',
      domain,
      message: `assetlinks.json declares no ${HANDLE_ALL_URLS} statement`,
      source,
    })
    return findings
  }

  if (app.packageIds.length === 0) {
    findings.push({
      severity: 'info',
      rule: 'package-unknown',
      domain,
      message: 'Skipped the package_name check — could not determine the applicationId',
      source: app.manifestPath,
    })
    return findings
  }

  const matched = handling.filter((s) => s.packageName && app.packageIds.includes(s.packageName))
  if (matched.length === 0) {
    findings.push({
      severity: 'error',
      rule: 'assetlinks-package-missing',
      domain,
      message: `assetlinks.json does not list ${app.packageIds.join(' / ')}`,
      detail: `Declared package_name: ${handling.map((s) => s.packageName ?? '(none)').join(', ')}`,
      source,
    })
    return findings
  }

  if (options.sha256) {
    const wanted = normalizeFingerprint(options.sha256)
    const declared = matched.flatMap((s) => s.fingerprints.map(normalizeFingerprint))
    if (!declared.includes(wanted)) {
      findings.push({
        severity: 'error',
        rule: 'assetlinks-fingerprint-missing',
        domain,
        message: 'The signing fingerprint is not listed in assetlinks.json',
        detail: `None of the ${declared.length} declared fingerprint(s) match`,
        source,
      })
    }
  } else {
    findings.push({
      severity: 'info',
      rule: 'fingerprint-skipped',
      domain,
      message: 'Skipped the signing fingerprint check',
      detail: 'Pass --sha256 <fingerprint> to enable it',
      source,
    })
  }

  return findings
}

export function checkAndroidUnresolved(app: AndroidApp): Finding[] {
  return app.unresolved.map((u) => ({
    severity: 'warn' as const,
    rule: 'host-unresolved',
    message: `Could not resolve host ${u.raw}`,
    detail: `${u.reason}. This host was skipped.`,
    source: app.manifestPath,
  }))
}
