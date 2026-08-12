import type { Finding, Severity } from '../types.js'

const COLOR: Record<Severity, string> = {
  error: '[31m',
  warn: '[33m',
  info: '[36m',
}
const DIM = '[2m'
const BOLD = '[1m'
const RESET = '[0m'

const LABEL: Record<Severity, string> = { error: 'ERROR', warn: 'WARN ', info: 'INFO ' }
const ORDER: Severity[] = ['error', 'warn', 'info']

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (s: string, c: string) => (useColor ? `${c}${s}${RESET}` : s)

export function printReport(findings: Finding[], checkedDomains: string[]) {
  console.log(`\n${paint('deeplink-parity', BOLD)} ${DIM}·${RESET} ${checkedDomains.length} domain(s) checked\n`)

  if (findings.length === 0) {
    console.log(paint('No problems found', '[32m'))
    console.log()
    return
  }

  for (const severity of ORDER) {
    for (const f of findings.filter((x) => x.severity === severity)) {
      const head = paint(LABEL[severity], COLOR[severity])
      // Not every finding is tied to a domain — fall back to the rule id so the line is never blank
      const subject = f.domain ? paint(f.domain, BOLD) : paint(f.rule, DIM)
      console.log(`${head}  ${subject}`)
      console.log(`       ${f.message}`)
      if (f.detail) console.log(`       ${paint(f.detail, DIM)}`)
      if (f.source) console.log(`       ${paint(f.source, DIM)}`)
      console.log()
    }
  }

  const counts = ORDER.map((s) => `${findings.filter((f) => f.severity === s).length} ${s}`)
  console.log(counts.join(', '))
  console.log()
}

export function exitCodeFor(findings: Finding[]) {
  return findings.some((f) => f.severity === 'error') ? 1 : 0
}
