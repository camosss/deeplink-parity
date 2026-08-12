#!/usr/bin/env node
import { resolve } from 'node:path'
import { localSource, networkSource } from './fetch/wellKnown.js'
import { exitCodeFor, printReport } from './report/console.js'
import { run } from './run.js'

const USAGE = `deeplink-parity — check that what your app declares about deep links
matches what is actually hosted, across iOS and Android.

Usage
  deeplink-parity [path] [options]

Options
  --sha256 <fingerprint>   Android signing fingerprint to look for in assetlinks.json
  --well-known <dir>       Read well-known files from <dir>/<domain>/ instead of the network
  --json                   Machine-readable output
  -h, --help               Show this message
`

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  let root = '.'
  let json = false
  let help = false
  let sha256: string | undefined
  let wellKnown: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') json = true
    else if (arg === '-h' || arg === '--help') help = true
    else if (arg === '--sha256') sha256 = args[++i]
    else if (arg === '--well-known') wellKnown = args[++i]
    else if (!arg.startsWith('-')) root = arg
  }

  return { root: resolve(root), json, help, sha256, wellKnown }
}

async function main() {
  const { root, json, help, sha256, wellKnown } = parseArgs(process.argv)

  if (help) {
    console.log(USAGE)
    return
  }

  const source = wellKnown ? localSource(resolve(wellKnown)) : networkSource()
  const result = await run({ root, source, sha256 })

  if (result.iosApps.length === 0 && result.androidApps.length === 0) {
    console.error(`No app configuration declaring deep links was found in ${root}`)
    console.error(
      'Expected a .entitlements file with applinks:, or an AndroidManifest.xml with intent-filters.',
    )
    process.exit(2)
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          ios: result.iosApps.map((a) => ({
            entitlements: a.entitlementsPath,
            teamId: a.teamId,
            bundleId: a.bundleId,
            domains: a.domains,
          })),
          android: result.androidApps.map((a) => ({
            manifest: a.manifestPath,
            packageIds: a.packageIds,
            hosts: a.hosts.map((h) => h.host),
          })),
          findings: result.findings,
        },
        null,
        2,
      ),
    )
  } else {
    printReport(result.findings, result.domains)
  }

  process.exit(exitCodeFor(result.findings))
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
