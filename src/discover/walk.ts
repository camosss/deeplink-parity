import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const SKIP_DIRS = new Set([
  'node_modules',
  'Pods',
  'Carthage',
  '.git',
  'build',
  'DerivedData',
  'dist',
  '.build',
  '.gradle',
  '.idea',
])

/** Depth-first file scan that skips dependency and build output directories. */
export async function walk(
  dir: string,
  match: (name: string) => boolean,
  out: string[] = [],
): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      // .xcodeproj is a directory but holds project.pbxproj
      await walk(join(dir, entry.name), match, out)
    } else if (match(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}
