import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FetchResult } from '../types.js'

const TIMEOUT_MS = 10_000

export const AASA_FILE = 'apple-app-site-association'
export const ASSETLINKS_FILE = 'assetlinks.json'

export function aasaUrl(domain: string) {
  return `https://${domain}/.well-known/${AASA_FILE}`
}

export function assetlinksUrl(domain: string) {
  return `https://${domain}/.well-known/${ASSETLINKS_FILE}`
}

export interface WellKnownSource {
  aasa(domain: string): Promise<FetchResult>
  assetlinks(domain: string): Promise<FetchResult>
}

/**
 * Apple does not follow redirects when fetching an AASA file, so neither do we —
 * a 3xx here is the finding, not something to chase.
 */
async function fetchRaw(url: string): Promise<FetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    const redirected = res.status >= 300 && res.status < 400
    return {
      url,
      ok: res.status === 200,
      status: res.status,
      redirected,
      location: res.headers.get('location') ?? undefined,
      contentType: res.headers.get('content-type') ?? undefined,
      body: redirected ? undefined : await res.text(),
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      url,
      ok: false,
      redirected: false,
      error: aborted
        ? `timed out after ${TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}

export function networkSource(): WellKnownSource {
  return {
    aasa: (domain) => fetchRaw(aasaUrl(domain)),
    assetlinks: (domain) => fetchRaw(assetlinksUrl(domain)),
  }
}

/**
 * Read well-known files from disk instead of the network, laid out as
 * `<dir>/<domain>/<file>`. Lets CI run without egress, and lets a web team validate
 * staged files before they are deployed. A missing file is reported as a 404 so the
 * rules behave exactly as they would against a live host.
 */
export function localSource(dir: string): WellKnownSource {
  const read = async (domain: string, file: string): Promise<FetchResult> => {
    const path = join(dir, domain, file)
    try {
      return {
        url: path,
        ok: true,
        status: 200,
        redirected: false,
        contentType: 'application/json',
        body: await readFile(path, 'utf8'),
      }
    } catch {
      return { url: path, ok: false, status: 404, redirected: false }
    }
  }
  return {
    aasa: (domain) => read(domain, AASA_FILE),
    assetlinks: (domain) => read(domain, ASSETLINKS_FILE),
  }
}
