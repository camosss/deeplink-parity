import { readFile } from 'node:fs/promises'

/** A resource reference can expand to more than one value — one per flavor or build type. */
export interface Resolution {
  values: string[]
  /** Set when at least one candidate could not be reduced to a literal. */
  unresolved?: string
}

const MAX_DEPTH = 8

export interface ResourceIndex {
  /** `<string name="x">value</string>` — one value per name */
  strings: Map<string, string>
  /** gradle `resValue("string", "x", <expr>)` — a name may appear once per variant */
  resValues: Map<string, string[]>
  /** flattened key/value pairs from every *.properties file found */
  properties: Map<string, string>
}

export function emptyIndex(): ResourceIndex {
  return { strings: new Map(), resValues: new Map(), properties: new Map() }
}

function stripQuotes(value: string) {
  const trimmed = value.trim()
  const quoted = /^(["'])([\s\S]*)\1$/.exec(trimmed)
  return quoted ? quoted[2] : trimmed
}

export async function indexStrings(paths: string[], index: ResourceIndex) {
  for (const path of paths) {
    const xml = await readFile(path, 'utf8')
    for (const m of xml.matchAll(/<string\s+[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) {
      if (!index.strings.has(m[1])) index.strings.set(m[1], m[2].trim())
    }
  }
}

/**
 * Matches both the Kotlin DSL (`resValue(type = "string", name = "x", value = expr)`,
 * arguments in any order) and the Groovy form (`resValue "string", "x", expr`).
 * Flavor attribution is deliberately skipped — a name that differs across variants
 * yields several candidates and we check all of them, which is what a checker wants.
 */
export async function indexResValues(paths: string[], index: ResourceIndex) {
  for (const path of paths) {
    const src = await readFile(path, 'utf8')

    for (const m of src.matchAll(/resValue\s*\(([\s\S]*?)\)\s*(?:\n|$)/g)) {
      const args = m[1]
      if (!/["']string["']/.test(args)) continue
      let name = /name\s*=\s*["']([^"']+)["']/.exec(args)?.[1]
      let value = name ? /value\s*=\s*([\s\S]+?)\s*$/.exec(args)?.[1] : undefined
      if (!name) {
        // parenthesised positional form — resValue("string", "host", "example.com")
        const positional = /^\s*["']string["']\s*,\s*["']([^"']+)["']\s*,\s*([\s\S]+?)\s*$/.exec(args)
        if (positional) {
          name = positional[1]
          value = positional[2]
        }
      }
      if (!name || !value) continue
      const list = index.resValues.get(name) ?? []
      list.push(value.trim())
      index.resValues.set(name, list)
    }

    for (const m of src.matchAll(/resValue\s+["']string["']\s*,\s*["']([^"']+)["']\s*,\s*(.+)/g)) {
      const list = index.resValues.get(m[1]) ?? []
      list.push(m[2].trim())
      index.resValues.set(m[1], list)
    }
  }
}

export async function indexProperties(paths: string[], index: ResourceIndex) {
  for (const path of paths) {
    const text = await readFile(path, 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      if (!index.properties.has(key)) {
        index.properties.set(key, stripQuotes(trimmed.slice(eq + 1)))
      }
    }
  }
}

/**
 * Reduce a gradle value expression to a literal.
 * Handles string literals and property lookups — `props["KEY"]`, `props.getProperty("KEY")`,
 * with or without a trailing cast. Anything else is left unresolved rather than guessed at.
 */
function resolveGradleExpression(expr: string, index: ResourceIndex): string | undefined {
  const literal = /^(["'])([^"']*)\1(?:\s+as\s+\w+)?$/.exec(expr.trim())
  if (literal) {
    // a double-quoted string containing $ is interpolated (Groovy GString, Kotlin
    // template) — treating "${envHost}.example.com" as a literal host once sent a
    // fetch to a domain that does not exist and misreported it as unreachable
    if (literal[1] === '"' && literal[2].includes('$')) return undefined
    return literal[2]
  }

  const lookup =
    /\[\s*["']([^"']+)["']\s*\]/.exec(expr) ?? /getProperty\(\s*["']([^"']+)["']\s*\)/.exec(expr)
  if (lookup) return index.properties.get(lookup[1])

  return undefined
}

/**
 * Expand a manifest attribute value. `@string/x` may chain through another `@string/y`
 * before landing on a literal, so resolution recurses with a depth guard.
 */
export function resolveRef(raw: string, index: ResourceIndex, depth = 0): Resolution {
  const value = raw.trim()
  if (!value.startsWith('@string/')) return { values: value ? [value] : [] }
  if (depth >= MAX_DEPTH) return { values: [], unresolved: 'reference chain is too deep or circular' }

  const name = value.slice('@string/'.length)
  const candidates: string[] = []

  const fromStrings = index.strings.get(name)
  if (fromStrings !== undefined) candidates.push(fromStrings)

  let sawUnresolvedExpression = false
  for (const expr of index.resValues.get(name) ?? []) {
    const literal = resolveGradleExpression(expr, index)
    if (literal === undefined) sawUnresolvedExpression = true
    else candidates.push(literal)
  }

  if (candidates.length === 0) {
    return {
      values: [],
      unresolved: sawUnresolvedExpression
        ? `could not resolve the gradle resValue expression for ${name}`
        : `no definition found for @string/${name}`,
    }
  }

  const values = new Set<string>()
  let unresolved: string | undefined = sawUnresolvedExpression
    ? `some gradle resValue values for ${name} could not be resolved`
    : undefined

  for (const candidate of candidates) {
    const nested = resolveRef(candidate, index, depth + 1)
    nested.values.forEach((v) => values.add(v))
    unresolved ??= nested.unresolved
  }

  return { values: [...values], unresolved: values.size > 0 ? undefined : unresolved }
}
