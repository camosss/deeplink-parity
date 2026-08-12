import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exitCodeFor } from '../src/report/console.js'
import type { Finding } from '../src/types.js'

const finding = (severity: Finding['severity'], source?: string): Finding => ({
  severity,
  rule: 'r',
  message: 'm',
  source,
})

test('exits non-zero only when there is an error', () => {
  assert.equal(exitCodeFor([]), 0)
  assert.equal(exitCodeFor([finding('info'), finding('warn')]), 0)
  assert.equal(exitCodeFor([finding('warn'), finding('error')]), 1)
})

test('annotates only sources that resolve inside the checkout', async (t) => {
  const { printGithubAnnotations } = await import('../src/report/github.js')
  const lines: string[] = []
  const original = console.log
  console.log = (line: string) => void lines.push(line)
  t.after(() => {
    console.log = original
  })

  printGithubAnnotations([
    finding('error', 'app/src/main/AndroidManifest.xml'),
    finding('warn', 'https://example.com/.well-known/assetlinks.json'),
    finding('info', '/somewhere/outside/the/checkout.json'),
  ])

  assert.equal(lines.length, 3)
  assert.ok(lines[0].includes('file=app/src/main/AndroidManifest.xml'))
  assert.ok(!lines[1].includes('file='), 'a URL is not a file')
  assert.ok(!lines[2].includes('file='), 'an absolute path is outside the checkout')
  assert.ok(lines[0].startsWith('::error '))
  assert.ok(lines[1].startsWith('::warning '))
  assert.ok(lines[2].startsWith('::notice '))
})
