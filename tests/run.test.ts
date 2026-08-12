import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { localSource } from '../src/fetch/wellKnown.js'
import { run } from '../src/run.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const MATCHING_SHA256 =
  'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'

const crossRun = (sha256?: string) =>
  run({
    roots: [join(FIXTURES, 'sample-cross')],
    source: localSource(join(FIXTURES, 'sample-cross', 'well-known')),
    sha256,
  })

const rulesFor = (findings: { rule: string; domain?: string }[], domain: string) =>
  findings.filter((f) => f.domain === domain).map((f) => f.rule)

test('resolves Android hosts through strings, gradle resValue and properties', async () => {
  const { androidApps } = await run({
    roots: [join(FIXTURES, 'sample-android')],
    source: localSource(join(FIXTURES, 'nonexistent')),
  })

  const hosts = androidApps.flatMap((a) => a.hosts.map((h) => h.host)).sort()
  assert.deepEqual(hosts, [
    '*.wildcard.example.com',
    'example.com',
    'links.example.com',
    'track-dev.example.com',
    'track.example.com',
    'unverified.example.com',
  ])
})

// Found by running against Bitwarden: `bitwarden://totp` has a host but is not an App Link
test('ignores hosts on custom-scheme intent-filters', async () => {
  const { androidApps, findings } = await run({
    roots: [join(FIXTURES, 'sample-android')],
    source: localSource(join(FIXTURES, 'nonexistent')),
  })

  const hosts = androidApps.flatMap((a) => a.hosts.map((h) => h.host))
  assert.ok(!hosts.includes('callback'))
  assert.ok(!findings.some((f) => f.domain === 'callback'))
})

// Found by running against Wikipedia: `applinks:*.wikipedia.org` is valid but unfetchable
test('skips wildcard domains instead of trying to fetch them', async () => {
  const { findings } = await run({
    roots: [join(FIXTURES, 'sample-android')],
    source: localSource(join(FIXTURES, 'nonexistent')),
  })

  assert.deepEqual(rulesFor(findings, '*.wildcard.example.com'), ['wildcard-domain'])
})

test('reports references it cannot resolve instead of dropping them', async () => {
  const { androidApps, findings } = await run({
    roots: [join(FIXTURES, 'sample-android')],
    source: localSource(join(FIXTURES, 'nonexistent')),
  })

  assert.deepEqual(
    androidApps.flatMap((a) => a.unresolved.map((u) => u.raw)),
    ['@string/host_missing'],
  )
  assert.ok(findings.some((f) => f.rule === 'host-unresolved'))
})

test('warns on an https intent-filter without autoVerify and does not fetch it', async () => {
  const { findings } = await run({
    roots: [join(FIXTURES, 'sample-android')],
    source: localSource(join(FIXTURES, 'nonexistent')),
  })

  assert.deepEqual(rulesFor(findings, 'unverified.example.com'), ['intent-filter-no-autoverify'])
})

test('pairs each entitlements file with its own target, not the first one found', async () => {
  const { iosApps } = await run({
    roots: [join(FIXTURES, 'sample-ios')],
    source: localSource(join(FIXTURES, 'nonexistent')),
  })

  assert.equal(iosApps.length, 1)
  assert.ok(iosApps[0].entitlementsPath.endsWith('sample-ios/App/App.entitlements'))
  assert.equal(iosApps[0].bundleId, 'com.example.sample')
  assert.equal(iosApps[0].teamId, 'ABCDE12345')
  // applinks only — webcredentials and the ?mode= suffix must not leak through
  assert.deepEqual(iosApps[0].domains, ['example.com', 'links.example.com'])
})

test('flags an appID that the AASA file does not list', async () => {
  const { findings } = await crossRun()
  assert.ok(rulesFor(findings, 'ios-only.example.com').includes('aasa-appid-missing'))
})

test('flags a package_name that assetlinks.json does not list', async () => {
  const { findings } = await crossRun()
  assert.ok(rulesFor(findings, 'android-only.example.com').includes('assetlinks-package-missing'))
})

test('reports domains declared on one platform only', async () => {
  const { findings } = await crossRun()
  const gaps = findings.filter((f) => f.rule === 'platform-domain-gap').map((f) => f.domain)
  assert.deepEqual(gaps.sort(), ['android-only.example.com', 'ios-only.example.com'])
})

test('treats an Android pathPrefix and the equivalent AASA glob as the same path', async () => {
  const { findings } = await crossRun()
  const gap = findings.find((f) => f.rule === 'platform-path-gap')

  assert.ok(gap, 'expected a path gap for the shared domain')
  assert.equal(gap.domain, 'shared.example.com')
  // /item is declared on both sides in different spellings and must not be reported
  assert.ok(!gap.detail?.includes('/item'))
  assert.ok(gap.detail?.includes('/promo'))
})

test('a matching signing fingerprint produces no finding', async () => {
  const { findings } = await crossRun(MATCHING_SHA256)
  assert.deepEqual(rulesFor(findings, 'shared.example.com'), ['platform-path-gap'])
})

test('a non-matching signing fingerprint is an error', async () => {
  const { findings } = await crossRun('00:11:22')
  assert.ok(
    rulesFor(findings, 'shared.example.com').includes('assetlinks-fingerprint-missing'),
  )
})

// Found by running against a real project: a dev domain's assetlinks names the
// suffixed application id, which must still be recognised as ours
test('counts applicationIdSuffix variants as the app', async () => {
  const { androidApps } = await run({
    roots: [join(FIXTURES, 'sample-cross')],
    source: localSource(join(FIXTURES, 'sample-cross', 'well-known')),
  })

  assert.deepEqual(androidApps[0].packageIds.sort(), [
    'com.example.sample',
    'com.example.sample.dev',
  ])
})
