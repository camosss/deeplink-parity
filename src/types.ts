export type Severity = 'error' | 'warn' | 'info'

export interface Finding {
  severity: Severity
  /** Stable rule id, e.g. "aasa-unreachable" */
  rule: string
  /** Domain the finding belongs to, when applicable */
  domain?: string
  message: string
  /** Why it matters, in one line */
  detail?: string
  /** Where it came from — a repo path or a URL */
  source?: string
  /** Known finding, frozen in the baseline file — reported but does not fail the run */
  baselined?: boolean
}

export interface IosApp {
  entitlementsPath: string
  /** Domains declared with the `applinks:` prefix */
  domains: string[]
  bundleId?: string
  teamId?: string
}

export interface FetchResult {
  url: string
  ok: boolean
  status?: number
  /** True when the server answered with a 3xx. Apple does not follow redirects for AASA. */
  redirected: boolean
  location?: string
  contentType?: string
  body?: string
  error?: string
}

/** An AASA `details` entry, normalised across the legacy and current formats. */
export interface AasaDetail {
  appIds: string[]
  /** Legacy `paths` array, if present */
  paths?: string[]
  /** Current `components` array, if present */
  components?: unknown[]
}

export interface Aasa {
  details: AasaDetail[]
}

export interface AndroidHost {
  /** Resolved literal host */
  host: string
  /** The manifest attribute as written, e.g. `@string/host_onelink` */
  raw: string
  schemes: string[]
  /** path / pathPrefix / pathPattern values declared alongside this host */
  paths: string[]
  autoVerify: boolean
}

export interface AndroidApp {
  manifestPath: string
  /** applicationId plus any flavor-specific overrides */
  packageIds: string[]
  hosts: AndroidHost[]
  /** Attribute values that could not be reduced to a literal host */
  unresolved: { raw: string; reason: string }[]
}

export interface AssetlinkStatement {
  relations: string[]
  packageName?: string
  fingerprints: string[]
}
