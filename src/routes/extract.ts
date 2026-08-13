import { access, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { displayPath } from '../discover/walk.js'
import type { Finding } from '../types.js'
import type { RoutePlatformConfig } from './config.js'

export interface ExtractedRoutes {
  platform: 'ios' | 'android'
  /** Files that were actually read, as display paths */
  files: string[]
  /** Sorted, deduplicated route paths */
  paths: string[]
}

/**
 * A config path is relative to whichever scanned root it exists under, so the same
 * file works locally (`~/ios ~/android`) and in CI (`ios/ android/`). Existing in
 * more than one root is ambiguous and reported rather than guessed at.
 */
async function resolveInRoots(file: string, roots: string[]): Promise<string[]> {
  if (isAbsolute(file)) {
    try {
      await access(file)
      return [file]
    } catch {
      return []
    }
  }
  const hits: string[] = []
  for (const root of roots) {
    const candidate = join(root, file)
    try {
      await access(candidate)
      hits.push(candidate)
    } catch {
      // not under this root
    }
  }
  return hits
}

export async function extractRoutes(
  platform: 'ios' | 'android',
  config: RoutePlatformConfig,
  roots: string[],
): Promise<{ routes?: ExtractedRoutes; findings: Finding[] }> {
  const findings: Finding[] = []
  const files: string[] = []
  const paths = new Set<string>()

  for (const file of config.files) {
    const hits = await resolveInRoots(file, roots)
    if (hits.length === 0) {
      findings.push({
        severity: 'error',
        rule: 'routes-file-missing',
        message: `Route file not found under any scanned root: ${file}`,
        detail: 'Fix the path in deeplink-parity.yml, or re-run `deeplink-parity init`',
      })
      continue
    }
    if (hits.length > 1) {
      findings.push({
        severity: 'error',
        rule: 'routes-file-ambiguous',
        message: `Route file exists under more than one root: ${file}`,
        detail: hits.map((h) => displayPath(h)).join(' · '),
      })
      continue
    }

    const content = await readFile(hits[0], 'utf8')
    files.push(displayPath(hits[0]))
    for (const m of content.matchAll(new RegExp(config.match, 'g'))) {
      paths.add(m[1] ?? m[0])
    }
  }

  if (files.length > 0 && paths.size === 0) {
    // matching nothing is a broken config, never a clean pass
    findings.push({
      severity: 'error',
      rule: 'routes-extraction-empty',
      message: `The ${platform} route regex matched nothing`,
      detail: `Pattern: ${config.match} · Files: ${files.join(', ')}. Verify with --print-routes.`,
      source: files[0],
    })
    return { findings }
  }

  if (files.length === 0) return { findings }
  return { routes: { platform, files, paths: [...paths].sort() }, findings }
}
