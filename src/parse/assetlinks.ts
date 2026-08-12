import type { AssetlinkStatement } from '../types.js'

export const HANDLE_ALL_URLS = 'delegate_permission/common.handle_all_urls'

/**
 * assetlinks.json is a top-level array of statements. Only `android_app` targets
 * matter here; web targets in the same file are ignored rather than treated as errors.
 */
export function parseAssetlinks(body: string): {
  statements?: AssetlinkStatement[]
  error?: string
} {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'invalid JSON' }
  }
  if (!Array.isArray(json)) return { error: 'top level is not an array' }

  const statements: AssetlinkStatement[] = []
  for (const entry of json) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const target = record['target'] as Record<string, unknown> | undefined
    if (!target || target['namespace'] !== 'android_app') continue

    const fingerprints = Array.isArray(target['sha256_cert_fingerprints'])
      ? target['sha256_cert_fingerprints'].filter((f): f is string => typeof f === 'string')
      : []

    statements.push({
      relations: Array.isArray(record['relation'])
        ? record['relation'].filter((r): r is string => typeof r === 'string')
        : [],
      packageName: typeof target['package_name'] === 'string' ? target['package_name'] : undefined,
      fingerprints,
    })
  }
  return { statements }
}

/** Fingerprints are colon-separated hex; comparison ignores case and separators. */
export function normalizeFingerprint(value: string) {
  return value.replace(/[^a-fA-F0-9]/g, '').toUpperCase()
}
