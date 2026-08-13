import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { localSource } from '../src/fetch/wellKnown.js'
import { findCandidates, suggestRegex } from '../src/routes/candidates.js'
import { loadRoutesConfig } from '../src/routes/config.js'
import { run } from '../src/run.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const CROSS = join(FIXTURES, 'sample-cross')

const ROUTES = {
  ios: { files: ['ios/App/DeepLinkRoutes.swift'], match: 'case \\w+ = "(/[a-z0-9/_-]+)"' },
  android: {
    files: ['android/app/src/main/java/DeepLinks.kt'],
    match: '[A-Z_]+\\("(/[a-z0-9/_-]+)"\\)',
  },
}

const source = () => localSource(join(CROSS, 'well-known'))

test('extracts both route tables from a single root', async () => {
  const { routes } = await run({ roots: [CROSS], source: source(), routes: ROUTES })

  assert.deepEqual(routes?.ios?.paths, ['/item', '/item/best', '/notice', '/search'])
  assert.deepEqual(routes?.android?.paths, ['/events', '/item', '/notice', '/search'])
})

test('reports the routes each platform is missing', async () => {
  const { findings } = await run({ roots: [CROSS], source: source(), routes: ROUTES })

  const gaps = findings.filter((f) => f.rule === 'route-gap').map((f) => f.message)
  assert.equal(gaps.length, 2)
  assert.ok(gaps.some((m) => m.includes('/item/best') && m.includes('not Android')))
  assert.ok(gaps.some((m) => m.includes('/events') && m.includes('not iOS')))
})

test('resolves per-root relative paths when each platform is its own root', async () => {
  // the same layout a two-repo CI checkout produces: ios/ and android/ as separate roots
  const { routes, findings } = await run({
    roots: [join(CROSS, 'ios'), join(CROSS, 'android')],
    source: source(),
    routes: {
      ios: { files: ['App/DeepLinkRoutes.swift'], match: ROUTES.ios.match },
      android: { files: ['app/src/main/java/DeepLinks.kt'], match: ROUTES.android.match },
    },
  })

  assert.equal(routes?.ios?.paths.length, 4)
  assert.equal(routes?.android?.paths.length, 4)
  assert.equal(findings.filter((f) => f.rule === 'route-gap').length, 2)
})

test('a regex that matches nothing is an error, never a clean pass', async () => {
  const { findings } = await run({
    roots: [CROSS],
    source: source(),
    routes: { ios: { files: ROUTES.ios.files, match: 'ZZZNOMATCH(/x)?' }, android: ROUTES.android },
  })

  assert.ok(findings.some((f) => f.rule === 'routes-extraction-empty' && f.severity === 'error'))
  // a broken extraction must not be diffed against a working one
  assert.equal(findings.filter((f) => f.rule === 'route-gap').length, 0)
})

test('one configured platform reports single-platform info, not gaps', async () => {
  const { findings } = await run({
    roots: [CROSS],
    source: source(),
    routes: { ios: ROUTES.ios },
  })

  assert.ok(findings.some((f) => f.rule === 'route-single-platform'))
  assert.equal(findings.filter((f) => f.rule === 'route-gap').length, 0)
})

test('a missing route file is reported with the configured path', async () => {
  const { findings } = await run({
    roots: [CROSS],
    source: source(),
    routes: { ios: { files: ['nope/Missing.swift'], match: ROUTES.ios.match } },
  })

  const miss = findings.find((f) => f.rule === 'routes-file-missing')
  assert.ok(miss?.message.includes('nope/Missing.swift'))
})

test('loads and validates the yaml config from the fixture', async () => {
  const config = await loadRoutesConfig(join(CROSS, 'deeplink-parity.yml'))
  assert.deepEqual(config.ios?.files, ['ios/App/DeepLinkRoutes.swift'])
  assert.ok(config.android?.match.includes('A-Z_'))
})

test('candidate scan surfaces the route tables as the top pick per platform', async () => {
  const candidates = await findCandidates([CROSS])

  const topIos = candidates.find((c) => c.platform === 'ios')
  const topAndroid = candidates.find((c) => c.platform === 'android')
  assert.ok(topIos?.file.endsWith('DeepLinkRoutes.swift'))
  assert.ok(topAndroid?.file.endsWith('DeepLinks.kt'))
})

test('regex suggestion merges several files into one table', async () => {
  const suggestions = await suggestRegex([
    join(CROSS, 'ios/App/DeepLinkRoutes.swift'),
    join(CROSS, 'android/app/src/main/java/DeepLinks.kt'),
  ])

  // the generic shape sees paths from both files
  const generic = suggestions.find((s) => s.name === 'any path string')
  assert.ok(generic?.paths.includes('/item/best'))
  assert.ok(generic?.paths.includes('/events'))
})

test('regex suggestion recognises the swift enum shape and extracts its paths', async () => {
  const suggestions = await suggestRegex([join(CROSS, 'ios/App/DeepLinkRoutes.swift')])

  assert.ok(suggestions.length > 0)
  assert.deepEqual(suggestions[0].paths, ['/item', '/item/best', '/notice', '/search'])
})

// Reported by the first real init user: a mistyped root was scanned as if it were an
// empty repository instead of failing loudly
test('a root that does not exist fails the run with a clear message', async () => {
  const { spawnSync } = await import('node:child_process')
  const cli = join(FIXTURES, '..', 'src', 'cli.ts')

  for (const args of [['./does-not-exist'], ['init', './does-not-exist', '--yes']]) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
      encoding: 'utf8',
    })
    assert.equal(result.status, 2)
    assert.ok(result.stderr.includes('Not a directory'))
    assert.ok(result.stderr.includes('does-not-exist'))
  }
})
