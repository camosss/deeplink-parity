import { readFile, stat } from 'node:fs/promises'
import { walk } from '../discover/walk.js'

export interface Candidate {
  file: string
  platform: 'ios' | 'android'
  /** Number of path-like string literals in the file */
  pathStrings: number
  score: number
}

export interface RegexSuggestion {
  name: string
  pattern: string
  paths: string[]
}

const PATH_STRING = /"\/[a-z0-9][a-z0-9/_-]*"/g
const NAME_HINT = /deeplink|deep-link|route|link|configure|navigat/i
// Retrofit / Moya files are full of path strings that are API endpoints, not routes
const API_MARKER = /@GET|@POST|@PUT|@DELETE|@PATCH\(|TargetType|baseURL|HttpUrl/
const SKIP_PATH = /\/(test|tests|androidTest|mock|mocks|__tests__|Pods|\.claude)\//i
const MAX_FILE_SIZE = 1_000_000

/**
 * Rank likely route-table files: many path-like strings, a routing hint in the name,
 * and not an API client. Scoring is deterministic — the user confirms the pick, so
 * precision comes from them, not from the heuristic.
 */
export async function findCandidates(roots: string[]): Promise<Candidate[]> {
  const sources: string[] = []
  for (const root of roots) {
    sources.push(
      ...(await walk(root, (n) => n.endsWith('.swift') || n.endsWith('.kt') || n.endsWith('.java'))),
    )
  }

  const candidates: Candidate[] = []
  for (const file of sources) {
    if (SKIP_PATH.test(file)) continue
    try {
      if ((await stat(file)).size > MAX_FILE_SIZE) continue
    } catch {
      continue
    }
    const content = await readFile(file, 'utf8')
    const pathStrings = (content.match(PATH_STRING) ?? []).length
    if (pathStrings < 3) continue

    let score = pathStrings
    if (NAME_HINT.test(file)) score += 30
    if (API_MARKER.test(content)) score -= 40

    candidates.push({
      file,
      platform: file.endsWith('.swift') ? 'ios' : 'android',
      pathStrings,
      score,
    })
  }

  return candidates.sort((a, b) => b.score - a.score)
}

/** Known table shapes, most specific first. Tried against the chosen file. */
const SHAPES: { name: string; pattern: string }[] = [
  { name: 'Swift enum rawValue', pattern: String.raw`case \w+\s*=\s*"(\/[^"\s]+)"` },
  { name: 'Swift path property', pattern: String.raw`let path\s*=\s*"(\/[^"\s]+)"` },
  { name: 'Kotlin enum argument', pattern: String.raw`[A-Z][A-Z_0-9]*\(\s*"(\/[^"\s]+)"` },
  { name: 'when/switch branch', pattern: String.raw`"(\/[^"\s]+)"\s*->` },
  { name: 'any path string', pattern: String.raw`"(\/[a-z0-9][a-z0-9\/_-]*)"` },
]

export async function suggestRegex(file: string): Promise<RegexSuggestion[]> {
  const content = await readFile(file, 'utf8')
  const suggestions: RegexSuggestion[] = []
  for (const shape of SHAPES) {
    const paths = [
      ...new Set([...content.matchAll(new RegExp(shape.pattern, 'g'))].map((m) => m[1])),
    ].sort()
    if (paths.length > 0) suggestions.push({ name: shape.name, pattern: shape.pattern, paths })
  }
  // best extraction first; ties keep the more specific shape ahead
  return suggestions.sort((a, b) => b.paths.length - a.paths.length)
}
