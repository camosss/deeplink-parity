import { access, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Finding } from './types.js'

export const BASELINE_NAME = 'deeplink-parity-baseline.json'

interface BaselineEntry {
  key: string
  /** For the human reviewing the file in a PR — never used for matching */
  summary: string
}

interface BaselineFile {
  entries: BaselineEntry[]
}

/**
 * Identity of a finding across runs. Domain problems key on rule + domain so a failure
 * that changes shape (404 today, timeout tomorrow) stays one known problem; findings
 * without a domain (route gaps) carry their identity in the message.
 */
export function baselineKey(f: Finding): string {
  // app-scoped rules carry a subject: the widget's missing appID and the app's are two
  // different problems on the same domain, and freezing one must not silence the other
  return `${f.rule}|${f.domain ?? f.message}${f.subject ? `|${f.subject}` : ''}`
}

/** Same lookup order as the route config: an explicit path wins, then cwd, then roots. */
export async function findBaseline(
  explicit: string | undefined,
  roots: string[],
): Promise<string | undefined> {
  if (explicit) return resolve(explicit)
  for (const dir of [process.cwd(), ...roots]) {
    const candidate = join(dir, BASELINE_NAME)
    try {
      await access(candidate)
      return candidate
    } catch {
      // keep looking
    }
  }
  return undefined
}

export async function loadBaseline(path: string): Promise<Set<string>> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as BaselineFile
  if (!Array.isArray(raw?.entries)) {
    throw new Error(`${path} is not a baseline file — expected an "entries" array`)
  }
  return new Set(raw.entries.map((e) => e.key))
}

/** Only findings that can fail a run belong in a baseline; info never fails. */
export async function writeBaseline(path: string, findings: Finding[]): Promise<number> {
  const entries = new Map<string, BaselineEntry>()
  for (const f of findings) {
    if (f.severity === 'info') continue
    const key = baselineKey(f)
    if (!entries.has(key)) {
      entries.set(key, { key, summary: [f.domain, f.message].filter(Boolean).join(' — ') })
    }
  }
  const sorted = [...entries.values()].sort((a, b) => a.key.localeCompare(b.key))
  await writeFile(path, `${JSON.stringify({ entries: sorted }, null, 2)}\n`)
  return sorted.length
}

export interface BaselineResult {
  /** Keys in the baseline that matched a current finding */
  matched: number
  /** Baseline entries whose finding no longer occurs */
  resolved: string[]
}

/**
 * Marks known findings in place and reports which baseline entries are now stale.
 * Exit-code policy lives in exitCodeFor: a baselined error no longer fails the run.
 */
export function applyBaseline(findings: Finding[], baseline: Set<string>): BaselineResult {
  const seen = new Set<string>()
  for (const f of findings) {
    if (f.severity === 'info') continue
    const key = baselineKey(f)
    if (baseline.has(key)) {
      f.baselined = true
      seen.add(key)
    }
  }
  return {
    matched: seen.size,
    resolved: [...baseline].filter((k) => !seen.has(k)).sort(),
  }
}
