import type { Aasa, AasaDetail } from '../types.js'

/**
 * AASA has two shapes for `applinks.details`:
 *   legacy   — an array of `{ appID, paths }`, or an object keyed by appID
 *   current  — an array of `{ appIDs, components }`
 * Both are still honoured by iOS, so we normalise rather than pick a side.
 */
export function parseAasa(body: string): { aasa?: Aasa; error?: string } {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'invalid JSON' }
  }

  const root = json as Record<string, unknown> | null
  const applinks = root?.['applinks'] as Record<string, unknown> | undefined
  if (!applinks) return { error: 'no "applinks" key' }

  const rawDetails = applinks['details']
  const details: AasaDetail[] = []

  const pushDetail = (entry: Record<string, unknown>, fallbackAppId?: string) => {
    const appIds: string[] = []
    if (Array.isArray(entry['appIDs'])) {
      for (const id of entry['appIDs']) if (typeof id === 'string') appIds.push(id)
    }
    if (typeof entry['appID'] === 'string') appIds.push(entry['appID'])
    if (appIds.length === 0 && fallbackAppId) appIds.push(fallbackAppId)

    details.push({
      appIds,
      paths: Array.isArray(entry['paths'])
        ? entry['paths'].filter((p): p is string => typeof p === 'string')
        : undefined,
      components: Array.isArray(entry['components']) ? entry['components'] : undefined,
    })
  }

  if (Array.isArray(rawDetails)) {
    for (const entry of rawDetails) {
      if (entry && typeof entry === 'object') pushDetail(entry as Record<string, unknown>)
    }
  } else if (rawDetails && typeof rawDetails === 'object') {
    // legacy object form: { "TEAMID.bundle.id": { paths: [...] } }
    for (const [appId, entry] of Object.entries(rawDetails)) {
      if (entry && typeof entry === 'object') {
        pushDetail(entry as Record<string, unknown>, appId)
      }
    }
  } else {
    return { error: '"applinks.details" missing or not an array/object' }
  }

  return { aasa: { details } }
}

/** An AASA appID may be `TEAMID.bundle.id` or the wildcard `TEAMID.*`. */
export function appIdMatches(declared: string, teamId: string, bundleId: string): boolean {
  const expected = `${teamId}.${bundleId}`
  if (declared === expected) return true
  if (declared === `${teamId}.*`) return true
  return false
}
