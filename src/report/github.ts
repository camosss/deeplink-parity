import { isAbsolute } from 'node:path'
import type { Finding, Severity } from '../types.js'

const LEVEL: Record<Severity, string> = {
  error: 'error',
  warn: 'warning',
  info: 'notice',
}

/** Workflow commands treat these characters as syntax and need them escaped. */
function escapeData(value: string) {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

function escapeProperty(value: string) {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C')
}

/**
 * GitHub Actions annotation format, so findings appear on the run summary — and on the
 * changed lines when a finding points at a file in the repository.
 * https://docs.github.com/actions/reference/workflow-commands-for-github-actions
 */
export function printGithubAnnotations(findings: Finding[]) {
  for (const f of findings) {
    const props: string[] = [`title=${escapeProperty(`deeplink-parity ${f.rule}`)}`]

    // Annotations anchor to a path inside the checkout. A source can also be a URL or an
    // absolute path outside it — neither anchors to anything, so the annotation stays
    // on the run summary instead of pointing at a file that will not resolve.
    if (f.source && !/^https?:\/\//.test(f.source) && !isAbsolute(f.source)) {
      props.push(`file=${escapeProperty(f.source)}`)
    }

    const body = [f.domain, f.message, f.detail].filter(Boolean).join(' — ')
    console.log(`::${LEVEL[f.severity]} ${props.join(',')}::${escapeData(body)}`)
  }
}
