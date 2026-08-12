#!/usr/bin/env node
import { resolve } from 'node:path'
import { localSource, networkSource } from './fetch/wellKnown.js'
import { exitCodeFor, printReport } from './report/console.js'
import { printGithubAnnotations } from './report/github.js'
import { run } from './run.js'

const USAGE = `deeplink-parity — check that what your app declares about deep links
matches what is actually hosted, across iOS and Android.

Usage
  deeplink-parity [path...] [options]

  Pass one path per checkout. iOS and Android usually live in separate
  repositories, and comparing them is the point:

    deeplink-parity ./my-app-ios ./my-app-android

Options
  --sha256 <fingerprint>   Android signing fingerprint to look for in assetlinks.json
  --well-known <dir>       Read well-known files from <dir>/<domain>/ instead of the network
  --json                   Machine-readable output
  --format github          GitHub Actions annotations (auto-detected on Actions)
  -h, --help               Show this message
`

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const roots: string[] = []
  let json = false
  let help = false
  let sha256: string | undefined
  let wellKnown: string | undefined
  // Actions sets GITHUB_ACTIONS=true; annotate by default there
  let format = process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'console'

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') json = true
    else if (arg === '-h' || arg === '--help') help = true
    else if (arg === '--sha256') sha256 = args[++i]
    else if (arg === '--well-known') wellKnown = args[++i]
    else if (arg === '--format') format = args[++i]
    else if (!arg.startsWith('-')) roots.push(arg)
  }

  return {
    roots: (roots.length ? roots : ['.']).map((r) => resolve(r)),
    json,
    help,
    sha256,
    wellKnown,
    format,
  }
}

async function main() {
  const { roots, json, help, sha256, wellKnown, format } = parseArgs(process.argv)

  if (help) {
    console.log(USAGE)
    return
  }

  const source = wellKnown ? localSource(resolve(wellKnown)) : networkSource()
  const result = await run({
    roots,
    source,
    sha256,
    onDiscovered: (count) => {
      // some apps declare a domain per country; say so before spending minutes on it
      if (!wellKnown && count > 50) {
        console.error(`Checking ${count} domains — requests are pooled, so this will take a while.`)
      }
    },
  })

  if (result.iosApps.length === 0 && result.androidApps.length === 0 && result.findings.length === 0) {
    console.error(`No app configuration declaring deep links was found in ${roots.join(', ')}`)
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
  } else if (format === 'github') {
    printGithubAnnotations(result.findings)
    printReport(result.findings, result.domains)
  } else {
    printReport(result.findings, result.domains)
  }

  process.exit(exitCodeFor(result.findings))
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
