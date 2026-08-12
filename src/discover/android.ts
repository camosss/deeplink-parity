import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import {
  emptyIndex,
  indexProperties,
  indexResValues,
  indexStrings,
  resolveRef,
} from '../resolve/androidResources.js'
import type { AndroidApp, AndroidHost } from '../types.js'
import { walk } from './walk.js'

const VIEW_ACTION = 'android.intent.action.VIEW'
const BROWSABLE = 'android.intent.category.BROWSABLE'

/** fast-xml-parser hands back a single object when an element occurs once. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function attr(node: unknown, name: string): string | undefined {
  if (!node || typeof node !== 'object') return undefined
  const value = (node as Record<string, unknown>)[`@_${name}`]
  return typeof value === 'string' ? value : undefined
}

function collectIntentFilters(node: unknown, out: unknown[]) {
  if (!node || typeof node !== 'object') return
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key.startsWith('@_')) continue
    if (key === 'intent-filter') out.push(...asArray(value))
    else for (const child of asArray(value)) collectIntentFilters(child, out)
  }
}

function applicationIds(gradleSources: string[]): string[] {
  const ids = new Set<string>()
  for (const src of gradleSources) {
    for (const m of src.matchAll(/applicationId\s*(?:=|\s)\s*["']([^"']+)["']/g)) {
      ids.add(m[1])
    }
  }
  return [...ids]
}

export async function discoverAndroid(root: string): Promise<AndroidApp[]> {
  const manifests = (await walk(root, (n) => n === 'AndroidManifest.xml')).filter(
    // androidTest/debug manifests rarely declare shipping deep links
    (p) => !/src\/(androidTest|test)\//.test(p),
  )
  if (manifests.length === 0) return []

  const index = emptyIndex()
  const gradlePaths = await walk(root, (n) => n === 'build.gradle' || n === 'build.gradle.kts')
  await indexStrings(
    (await walk(root, (n) => n.endsWith('.xml'))).filter((p) => /res\/values[^/]*\//.test(p)),
    index,
  )
  await indexResValues(gradlePaths, index)
  await indexProperties(await walk(root, (n) => n.endsWith('.properties')), index)

  const gradleSources = await Promise.all(gradlePaths.map((p) => readFile(p, 'utf8')))
  const packageIds = applicationIds(gradleSources)

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
  const apps: AndroidApp[] = []

  for (const manifestPath of manifests) {
    const parsed = parser.parse(await readFile(manifestPath, 'utf8'))
    const filters: unknown[] = []
    collectIntentFilters(parsed, filters)

    const hosts = new Map<string, AndroidHost>()
    const unresolved: { raw: string; reason: string }[] = []

    for (const filter of filters) {
      const node = filter as Record<string, unknown>
      const actions = asArray(node['action']).map((a) => attr(a, 'android:name'))
      const categories = asArray(node['category']).map((c) => attr(c, 'android:name'))
      if (!actions.includes(VIEW_ACTION)) continue
      if (!categories.includes(BROWSABLE)) continue

      const autoVerify = attr(node, 'android:autoVerify') === 'true'
      const dataNodes = asArray(node['data'])

      // scheme/host/path are declared across sibling <data> elements and merge per filter
      const schemes = new Set<string>()
      const paths = new Set<string>()
      const rawHosts: string[] = []

      for (const data of dataNodes) {
        for (const raw of [attr(data, 'android:scheme')].filter(Boolean) as string[]) {
          resolveRef(raw, index).values.forEach((v) => schemes.add(v))
        }
        for (const key of ['android:path', 'android:pathPrefix', 'android:pathPattern']) {
          const raw = attr(data, key)
          if (!raw) continue
          // a prefix implicitly matches everything below it; make that explicit so it
          // lines up with the glob style AASA uses
          const suffix = key === 'android:pathPrefix' ? '*' : ''
          resolveRef(raw, index).values.forEach((v) => paths.add(`${v}${suffix}`))
        }
        const rawHost = attr(data, 'android:host')
        if (rawHost) rawHosts.push(rawHost)
      }

      // Only http(s) filters are App Links. A custom scheme like `bitwarden://totp`
      // also carries a host, but it has no assetlinks counterpart and nothing to verify.
      if (!schemes.has('http') && !schemes.has('https')) continue

      for (const raw of rawHosts) {
        const resolution = resolveRef(raw, index)
        if (resolution.values.length === 0) {
          unresolved.push({ raw, reason: resolution.unresolved ?? 'resolution failed' })
          continue
        }
        for (const host of resolution.values) {
          const existing = hosts.get(host)
          if (existing) {
            existing.autoVerify ||= autoVerify
            schemes.forEach((s) => existing.schemes.includes(s) || existing.schemes.push(s))
            paths.forEach((p) => existing.paths.includes(p) || existing.paths.push(p))
          } else {
            hosts.set(host, {
              host,
              raw,
              schemes: [...schemes],
              paths: [...paths],
              autoVerify,
            })
          }
        }
      }
    }

    if (hosts.size === 0 && unresolved.length === 0) continue
    apps.push({
      manifestPath: relative(root, manifestPath),
      packageIds,
      hosts: [...hosts.values()],
      unresolved,
    })
  }
  return apps
}
