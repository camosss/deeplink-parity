import type { Finding } from '../types.js'

/**
 * `applinks:*.example.com` (and the Android equivalent) is a valid declaration, but
 * there is no host to fetch: the well-known file has to exist on each concrete
 * subdomain, and we cannot enumerate those from the repo.
 */
export function isWildcardDomain(domain: string) {
  return domain.startsWith('*.')
}

export function wildcardFinding(domain: string, source: string): Finding {
  return {
    severity: 'info',
    rule: 'wildcard-domain',
    domain,
    message: 'Wildcard domain — skipped',
    detail:
      'Every concrete subdomain must serve its own well-known file. Pass one explicitly to check it.',
    source,
  }
}
