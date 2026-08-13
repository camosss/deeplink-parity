import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { load } from 'js-yaml'

export interface RoutePlatformConfig {
  /** Route-table files, relative to whichever scanned root they exist under */
  files: string[]
  /** Regex applied per file; capture group 1 (or the whole match) is the path */
  match: string
}

export interface RoutesConfig {
  ios?: RoutePlatformConfig
  android?: RoutePlatformConfig
}

const CONFIG_NAMES = ['deeplink-parity.yml', 'deeplink-parity.yaml']

/**
 * An explicit --config always wins. Otherwise the file is looked up in the working
 * directory first, then in each scanned root, so a monorepo can keep it at its root
 * and a two-repo setup can keep it in either checkout.
 */
export async function findConfig(
  explicit: string | undefined,
  roots: string[],
): Promise<string | undefined> {
  if (explicit) return resolve(explicit)
  for (const dir of [process.cwd(), ...roots]) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name)
      try {
        await access(candidate)
        return candidate
      } catch {
        // keep looking
      }
    }
  }
  return undefined
}

/** Throws with a plain message on a malformed config — that is a setup error, not a finding. */
export async function loadRoutesConfig(path: string): Promise<RoutesConfig> {
  const raw = load(await readFile(path, 'utf8')) as Record<string, unknown> | null
  const routes = raw?.['routes'] as Record<string, unknown> | undefined
  if (!routes || typeof routes !== 'object') return {}

  const normalize = (key: string): RoutePlatformConfig | undefined => {
    const entry = routes[key] as Record<string, unknown> | undefined
    if (!entry) return undefined
    const files = Array.isArray(entry['files'])
      ? entry['files'].filter((f): f is string => typeof f === 'string')
      : typeof entry['file'] === 'string'
        ? [entry['file']]
        : []
    const match = entry['match']
    if (files.length === 0 || typeof match !== 'string') {
      throw new Error(`routes.${key} needs "file" (or "files") and "match" in ${path}`)
    }
    try {
      // validate early so a bad pattern fails the run, not silently matches nothing
      new RegExp(match, 'g')
    } catch (err) {
      throw new Error(`routes.${key}.match is not a valid regex: ${(err as Error).message}`)
    }
    return { files, match }
  }

  return { ios: normalize('ios'), android: normalize('android') }
}
