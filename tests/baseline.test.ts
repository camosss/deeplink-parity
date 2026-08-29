import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { applyBaseline, baselineKey, loadBaseline, writeBaseline } from '../src/baseline.js'
import { exitCodeFor } from '../src/report/console.js'
import type { Finding } from '../src/types.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

const finding = (over: Partial<Finding>): Finding => ({
  severity: 'error',
  rule: 'aasa-unreachable',
  message: 'AASA responded with 404',
  ...over,
})

test('a domain problem keeps its identity when the failure changes shape', () => {
  const yesterday = finding({ domain: 'a.example.com', message: 'AASA responded with 404' })
  const today = finding({ domain: 'a.example.com', message: 'Could not fetch the AASA file — timed out' })
  assert.equal(baselineKey(yesterday), baselineKey(today))
})

test('a route gap keys on its message, not just its rule', () => {
  const a = finding({ rule: 'route-gap', message: '/a is in the iOS route table but not Android\'s' })
  const b = finding({ rule: 'route-gap', message: '/b is in the iOS route table but not Android\'s' })
  assert.notEqual(baselineKey(a), baselineKey(b))
})

test('baselined errors stop failing the run; new ones still do', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dlp-'))
  const path = join(dir, 'baseline.json')
  try {
    const known = finding({ domain: 'known.example.com' })
    await writeBaseline(path, [known])
    const baseline = await loadBaseline(path)

    const onlyKnown = [finding({ domain: 'known.example.com' })]
    applyBaseline(onlyKnown, baseline)
    assert.equal(exitCodeFor(onlyKnown), 0)
    assert.equal(onlyKnown[0].baselined, true)

    const withNew = [finding({ domain: 'known.example.com' }), finding({ domain: 'new.example.com' })]
    applyBaseline(withNew, baseline)
    assert.equal(exitCodeFor(withNew), 1)
  } finally {
    await rm(dir, { recursive: true })
  }
})

test('info findings never enter the baseline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dlp-'))
  const path = join(dir, 'baseline.json')
  try {
    const count = await writeBaseline(path, [
      finding({ severity: 'info', rule: 'fingerprint-skipped', domain: 'x.example.com' }),
      finding({ domain: 'y.example.com' }),
    ])
    assert.equal(count, 1)
  } finally {
    await rm(dir, { recursive: true })
  }
})

test('a stale baseline entry is reported as resolved', () => {
  const gone = finding({ domain: 'fixed.example.com' })
  const result = applyBaseline([], new Set([baselineKey(gone)]))
  assert.equal(result.matched, 0)
  assert.deepEqual(result.resolved, [baselineKey(gone)])
})

// End to end through the CLI: freeze, then re-run — the same findings no longer fail
test('the baseline subcommand turns a failing check green', async () => {
  const { spawnSync } = await import('node:child_process')
  const cli = join(FIXTURES, '..', 'src', 'cli.ts')
  const cross = join(FIXTURES, 'sample-cross')
  const wk = join(cross, 'well-known')
  const dir = await mkdtemp(join(tmpdir(), 'dlp-'))
  const file = join(dir, 'deeplink-parity-baseline.json')

  // cwd stays at the repo so --import tsx resolves; the baseline path is explicit anyway
  const runCli = (...extra: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', cli, ...extra], { encoding: 'utf8' })

  try {
    // fixture has 2 errors → red
    assert.equal(runCli(cross, '--well-known', wk).status, 1)

    const freeze = runCli('baseline', cross, '--well-known', wk, '--baseline', file)
    assert.equal(freeze.status, 0)
    const written = JSON.parse(await readFile(file, 'utf8'))
    assert.ok(written.entries.length >= 2)
    // reviewable: every entry carries a human summary
    assert.ok(written.entries.every((e: { summary: string }) => e.summary.length > 0))

    // same findings, now known → green, and the header says so
    const second = runCli(cross, '--well-known', wk, '--baseline', file)
    assert.equal(second.status, 0)
    assert.ok(second.stdout.includes('failing on new only'))
    assert.ok(second.stdout.includes('(baselined)'))
  } finally {
    await rm(dir, { recursive: true })
  }
})

test("freezing the widget's missing appID does not silence the app's on the same domain", async () => {
  const { baselineKey } = await import('../src/baseline.js')
  const widget = { severity: 'error' as const, rule: 'aasa-appid-missing', domain: 'example.com', subject: 'T.com.example.Widget', message: 'w' }
  const app = { severity: 'error' as const, rule: 'aasa-appid-missing', domain: 'example.com', subject: 'T.com.example', message: 'a' }
  assert.notEqual(baselineKey(widget), baselineKey(app))
})
