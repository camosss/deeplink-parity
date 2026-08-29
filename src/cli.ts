#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { applyBaseline, BASELINE_NAME, findBaseline, loadBaseline, writeBaseline } from './baseline.js'
import { localSource, networkSource } from './fetch/wellKnown.js'
import { exitCodeFor, printReport, type FailOn } from './report/console.js'
import { printGithubAnnotations } from './report/github.js'
import { findConfig, loadRoutesConfig } from './routes/config.js'
import { runInit } from './routes/init.js'
import { run } from './run.js'

const USAGE = `deeplink-parity — check that what your app declares about deep links
matches what is actually hosted, across iOS and Android.

Usage
  deeplink-parity [path...] [options]        check (default)
  deeplink-parity init [path...]             interactive setup for route comparison
  deeplink-parity baseline [path...]         freeze current findings; checks then fail on new ones only

  Pass one path per checkout. iOS and Android usually live in separate
  repositories, and comparing them is the point:

    deeplink-parity ./my-app-ios ./my-app-android

Options
  --sha256 <fingerprint>   Android signing fingerprint to look for in assetlinks.json
  --well-known <dir>       Read well-known files from <dir>/<domain>/ instead of the network
  --config <file>          Route config (default: deeplink-parity.yml in cwd or a root)
  --baseline <file>        Baseline file (default: deeplink-parity-baseline.json in cwd or a root)
  --print-routes           Print the extracted route tables before the report
  --json                   Machine-readable output on stdout
  --output <file>          Also write the JSON result to a file
  --format github          GitHub Actions annotations (auto-detected on Actions)
  --yes                    init only: accept the top suggestion without prompting
  -v, --version            Print the version
  -h, --help               Show this message

The check reads the repositories and GETs two public well-known files per domain —
it never writes to the repositories it scans. init writes exactly one file
(deeplink-parity.yml), shows the content first, and asks.
`

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const positional: string[] = []
  let json = false
  let help = false
  let version = false
  let printRoutes = false
  let yes = false
  let sha256: string | undefined
  let wellKnown: string | undefined
  let output: string | undefined
  let config: string | undefined
  let baseline: string | undefined
  let failOn: FailOn = 'error'
  // Actions sets GITHUB_ACTIONS=true; annotate by default there
  let format = process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'console'

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') json = true
    else if (arg === '-h' || arg === '--help') help = true
    else if (arg === '-v' || arg === '--version') version = true
    else if (arg === '--print-routes') printRoutes = true
    else if (arg === '--yes') yes = true
    else if (arg === '--sha256') sha256 = args[++i]
    else if (arg === '--well-known') wellKnown = args[++i]
    else if (arg === '--format') format = args[++i]
    else if (arg === '--output') output = args[++i]
    else if (arg === '--config') config = args[++i]
    else if (arg === '--baseline') baseline = args[++i]
    else if (arg === '--fail-on') {
      const v = args[++i]
      if (v !== 'error' && v !== 'warn' && v !== 'never') {
        console.error(`error: --fail-on must be "error", "warn" or "never", got "${v}"`)
        process.exit(2)
      }
      failOn = v
    }
    else if (arg.startsWith('-')) {
      // a mistyped flag must not become a scan root or silently drop an option —
      // --well-knwon once sent a "no egress" CI run out to the real network
      console.error(`error: unknown flag "${arg}" — see --help`)
      process.exit(2)
    } else positional.push(arg)
  }

  if (format !== 'console' && format !== 'github') {
    console.error(`error: --format must be "console" or "github", got "${format}"`)
    process.exit(2)
  }

  const command = positional[0] === 'init' || positional[0] === 'baseline' ? positional[0] : 'check'
  const roots = (command === 'check' ? positional : positional.slice(1)).map((r) => resolve(r))

  return {
    command,
    roots: roots.length ? roots : [resolve('.')],
    json,
    help,
    version,
    printRoutes,
    yes,
    sha256,
    wellKnown,
    output,
    config,
    baseline,
    format,
    failOn,
  }
}

/**
 * A mistyped path must fail loudly. Scanning a directory that does not exist would
 * read exactly like an empty repository — "no candidates", "nothing declared" — and
 * a wrong answer that looks like a clean one is the failure mode this tool exists
 * to prevent.
 */
async function assertRootsExist(roots: string[]) {
  for (const root of roots) {
    let ok = false
    try {
      ok = (await stat(root)).isDirectory()
    } catch {
      // fall through to the error below
    }
    if (!ok) {
      console.error(`Not a directory: ${root}`)
      console.error('Pass the path to each checkout, e.g. deeplink-parity ./app-ios ./app-android')
      process.exit(2)
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv)

  const pkg = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string }

  if (opts.version) {
    console.log(pkg.version)
    return
  }

  if (opts.help) {
    console.log(USAGE)
    return
  }

  await assertRootsExist(opts.roots)

  if (opts.command === 'init') {
    process.exit(await runInit(opts.roots, opts.yes))
  }

  const configPath = await findConfig(opts.config, opts.roots)
  const routes = configPath ? await loadRoutesConfig(configPath) : undefined
  // the baseline subcommand regenerates the file, so it must not also consume one
  const baselinePath =
    opts.command === 'baseline' ? undefined : await findBaseline(opts.baseline, opts.roots)
  const baseline = baselinePath ? await loadBaseline(baselinePath) : undefined

  const source = opts.wellKnown ? localSource(resolve(opts.wellKnown)) : networkSource()
  const result = await run({
    roots: opts.roots,
    source,
    sha256: opts.sha256,
    routes,
    onDiscovered: (count) => {
      // some apps declare a domain per country; say so before spending minutes on it
      if (!opts.wellKnown && count > 50) {
        console.error(`Checking ${count} domains — requests are pooled, so this will take a while.`)
      }
    },
  })

  if (opts.command === 'baseline') {
    const target = opts.baseline ? resolve(opts.baseline) : resolve(BASELINE_NAME)
    const count = await writeBaseline(target, result.findings)
    console.log(`Froze ${count} finding(s) into ${target}`)
    console.log('Commit it. From now on the check fails only on findings that are not in this file.')
    console.log('Re-run `deeplink-parity baseline` after fixing something, to tighten it.')
    return
  }

  const applied = baseline ? applyBaseline(result.findings, baseline) : undefined
  if (applied) {
    for (const key of applied.resolved) {
      result.findings.push({
        severity: 'info',
        rule: 'baseline-resolved',
        message: `A baselined finding no longer occurs: ${key}`,
        detail: 'Re-run `deeplink-parity baseline` to tighten the baseline.',
        source: baselinePath,
      })
    }
  }

  // a run that successfully extracted route tables is a legitimate run — before this
  // guard, a routes-only run failed exactly when every route matched and passed when
  // there were gaps, inverting success and failure
  const routesExtracted = Boolean(result.routes?.ios ?? result.routes?.android)
  const nothingFound =
    result.iosApps.length === 0 &&
    result.androidApps.length === 0 &&
    result.findings.length === 0 &&
    !routesExtracted
  if (nothingFound) {
    console.error(`No app configuration declaring deep links was found in ${opts.roots.join(', ')}`)
    console.error(
      'Expected a .entitlements file with applinks:, or an AndroidManifest.xml with intent-filters.',
    )
    process.exit(2)
  }

  if (opts.printRoutes && result.routes) {
    for (const table of [result.routes.ios, result.routes.android]) {
      if (!table) continue
      console.log(`\n${table.platform === 'ios' ? 'iOS' : 'Android'} routes (${table.paths.length}) — ${table.files.join(', ')}`)
      for (const path of table.paths) console.log(`  ${path}`)
    }
    console.log()
  }

  const payload = {
    version: pkg.version,
    routeConfig: configPath,
    baseline: baselinePath ? { path: baselinePath, matched: applied?.matched ?? 0 } : undefined,
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
    routes: result.routes
      ? {
          ios: result.routes.ios ? { files: result.routes.ios.files, paths: result.routes.ios.paths } : undefined,
          android: result.routes.android
            ? { files: result.routes.android.files, paths: result.routes.android.paths }
            : undefined,
        }
      : undefined,
    summary: {
      domains: result.domains.length,
      // counts exclude baselined findings, matching the exit-code semantics — a
      // consumer branching on `error` must agree with whether the run failed
      error: result.findings.filter((f) => f.severity === 'error' && !f.baselined).length,
      warn: result.findings.filter((f) => f.severity === 'warn' && !f.baselined).length,
      info: result.findings.filter((f) => f.severity === 'info' && !f.baselined).length,
      baselined: result.findings.filter((f) => f.baselined).length,
    },
    findings: result.findings,
  }

  // A file keeps stdout free, so annotations and the readable report can coexist with
  // machine-readable output in the same run.
  if (opts.output) await writeFile(opts.output, `${JSON.stringify(payload, null, 2)}\n`)

  const baselineLine = baselinePath
    ? ` · baseline: ${applied?.matched ?? 0} known finding(s), failing on new only`
    : ''
  const routesLine = (configPath
    ? `routes: ${configPath}` +
      (result.routes
        ? ` (iOS ${result.routes.ios?.paths.length ?? 0} · Android ${result.routes.android?.paths.length ?? 0})`
        : '')
    : 'routes: no config found — run "deeplink-parity init" to compare route tables') +
    baselineLine

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2))
  } else {
    if (opts.format === 'github') printGithubAnnotations(result.findings)
    printReport(result.findings, result.domains, { version: pkg.version, routesLine })
  }

  process.exit(exitCodeFor(result.findings, opts.failOn))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(2)
})
