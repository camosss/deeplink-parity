import { access, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createInterface, type Interface } from 'node:readline/promises'
import { dump } from 'js-yaml'
import { findCandidates, suggestRegex, type Candidate } from './candidates.js'

interface PlatformPick {
  file?: string
  files?: string[]
  match: string
}

const PREVIEW = 8

/** The config records paths relative to the root a file lives under, never absolute. */
function rootRelative(file: string, roots: string[]): string {
  for (const root of roots) {
    const rel = relative(root, file)
    if (!rel.startsWith('..')) return rel
  }
  return file
}

async function pickFiles(
  rl: Interface,
  platform: 'ios' | 'android',
  candidates: Candidate[],
  yes: boolean,
): Promise<string[]> {
  const top = candidates.filter((c) => c.platform === platform).slice(0, 5)

  if (top.length === 0) {
    if (yes) return []
    const manual = (
      await rl.question(`No ${platform} route-file candidates found. Enter a path, or leave blank to skip: `)
    ).trim()
    return manual ? [manual] : []
  }

  if (yes) return [top[0].file]

  console.log(`\n${platform === 'ios' ? 'iOS' : 'Android'} route file candidates:`)
  top.forEach((c, i) => console.log(`  ${i + 1}. ${c.file}  (${c.pathStrings} path strings)`))
  console.log(`  m. enter a path manually`)
  console.log(`  s. skip ${platform}`)
  console.log(`  (several numbers select several files, e.g. "1 2")`)

  // an answer that cannot be interpreted is asked again — never silently narrowed
  for (;;) {
    const answer = (await rl.question('> ')).trim().toLowerCase()
    if (answer === 's' || answer === '') return []
    if (answer === 'm') {
      const manual = (await rl.question('path: ')).trim()
      return manual ? [manual] : []
    }
    const tokens = answer.split(/[,\s]+/)
    const indexes = tokens.map((t) => Number.parseInt(t, 10))
    const valid =
      indexes.length > 0 &&
      indexes.every((n, i) => Number.isInteger(n) && String(n) === tokens[i] && n >= 1 && n <= top.length)
    if (valid) return [...new Set(indexes)].map((n) => top[n - 1].file)
    console.log(`  Could not read "${answer}" — numbers 1-${top.length}, "m" or "s".`)
  }
}

async function pickRegex(rl: Interface, files: string[], yes: boolean): Promise<string | undefined> {
  const suggestions = await suggestRegex(files)

  if (suggestions.length > 0) {
    const best = suggestions[0]
    const preview = best.paths.slice(0, PREVIEW).join(', ')
    const more = best.paths.length > PREVIEW ? ` … +${best.paths.length - PREVIEW} more` : ''
    console.log(`\n  Recognised shape: ${best.name}`)
    console.log(`  Extracts ${best.paths.length} path(s): ${preview}${more}`)
    if (yes) return best.pattern

    const answer = (
      await rl.question('  Use this? (Y = yes / r = enter my own regex): ')
    ).trim().toLowerCase()
    if (answer === '' || answer === 'y') return best.pattern
  } else {
    console.log('\n  No known shape matched this file.')
    if (yes) return undefined
  }

  const custom = (
    await rl.question('  Regex (capture group 1 = path), blank to skip: ')
  ).trim()
  return custom || undefined
}

/**
 * The only command that writes anything, and it writes exactly one file — the config —
 * after printing its full content and asking. The scanned repositories are never touched.
 */
export async function runInit(roots: string[], yes: boolean): Promise<number> {
  console.log(`Scanning ${roots.length} root(s) for route tables…`)
  const candidates = await findCandidates(roots)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const picks: { ios?: PlatformPick; android?: PlatformPick } = {}

    for (const platform of ['ios', 'android'] as const) {
      const files = await pickFiles(rl, platform, candidates, yes)
      if (files.length === 0) continue
      const match = await pickRegex(rl, files, yes)
      if (!match) continue
      const relative = files.map((f) => rootRelative(f, roots))
      picks[platform] =
        relative.length === 1 ? { file: relative[0], match } : { files: relative, match }
    }

    if (!picks.ios && !picks.android) {
      console.log('\nNothing selected — no config written.')
      return 2
    }

    const yaml = dump({
      routes: Object.fromEntries(
        Object.entries(picks).map(([platform, pick]) => [platform, pick]),
      ),
    })
    const target = join(process.cwd(), 'deeplink-parity.yml')

    console.log(`\nThis will be written to ${target}:\n`)
    console.log(yaml.replace(/^/gm, '  '))

    try {
      await access(target)
      const answer = yes
        ? 'y'
        : (await rl.question('deeplink-parity.yml already exists. Overwrite? (y/N): ')).trim().toLowerCase()
      if (answer !== 'y') {
        console.log('Left the existing file alone.')
        return 2
      }
    } catch {
      if (!yes) {
        const answer = (await rl.question('Write it? (Y/n): ')).trim().toLowerCase()
        if (answer === 'n') {
          console.log('Nothing written.')
          return 2
        }
      }
    }

    await writeFile(target, yaml)
    console.log(`Wrote ${target} — commit it, then run the check as usual.`)
    console.log('The check itself never writes to the repositories it scans.')
    return 0
  } finally {
    rl.close()
  }
}
