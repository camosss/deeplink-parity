import { readdir, realpath, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

/**
 * Paths are shown relative to the working directory rather than to the scanned root,
 * so that a run covering two checkouts stays unambiguous.
 */
export function displayPath(absolute: string) {
  const rel = relative(process.cwd(), absolute)
  return rel.startsWith('..') ? absolute : rel
}

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

/**
 * Depth-first file scan that skips dependency and build output directories.
 *
 * Symlinked directories are followed, so a folder of links to several checkouts works
 * as a single root. Real paths are tracked to stop a link cycle from recursing forever.
 */
export async function walk(
  dir: string,
  match: (name: string) => boolean,
  out: string[] = [],
  seen: Set<string> = new Set(),
): Promise<string[]> {
  let here: string
  try {
    here = await realpath(dir)
  } catch {
    return out
  }
  if (seen.has(here)) return out
  seen.add(here)

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }

  for (const entry of entries) {
    const path = join(dir, entry.name)
    let isDir = entry.isDirectory()

    if (entry.isSymbolicLink()) {
      try {
        isDir = (await stat(path)).isDirectory()
      } catch {
        continue // broken link
      }
    }

    if (isDir) {
      if (SKIP_DIRS.has(entry.name)) continue
      // .xcodeproj is a directory but holds project.pbxproj
      await walk(path, match, out, seen)
    } else if (match(entry.name)) {
      out.push(path)
    }
  }
  return out
}
