/**
 * Path containment that survives symlinks.
 *
 * path.resolve() only normalizes text. A configured directory that reaches the tool folder through a
 * symlink has a different string, so a prefix check on resolved strings misses it. canonicalPath()
 * resolves symlinks first, so two spellings of one place compare equal.
 */

import { realpathSync, lstatSync } from 'node:fs';
import { resolve, dirname, basename, join, relative, isAbsolute, sep } from 'node:path';

/**
 * Absolute path with every symlink in its existing part resolved. For a destination that does not
 * exist yet, the nearest existing ancestor is resolved and the missing segments are appended.
 * Throws (so callers fail closed) when a path cannot be resolved with confidence: a dangling or
 * looping symlink, a segment that is a file, or an unreadable directory.
 */
export function canonicalPath(p) {
  const abs = resolve(p);
  const missing = [];
  for (let cur = abs; ; ) {
    try {
      const real = realpathSync(cur);
      return missing.length ? join(real, ...missing.reverse()) : real;
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error(`cannot resolve ${abs} (${e.code}). Use a directory you can read, with no symlink loop.`);
      let isLink = false;
      try { isLink = lstatSync(cur).isSymbolicLink(); } catch { /* nothing at this segment */ }
      if (isLink) throw new Error(`cannot resolve ${abs}: ${cur} is a symlink to a path that does not exist, so where it leads is unknown.`);
      const parent = dirname(cur);
      if (parent === cur) throw new Error(`cannot resolve ${abs}: no part of it exists.`);
      missing.push(basename(cur));
      cur = parent;
    }
  }
}

/** True when `child` is `parent` or inside it. Compares whole path segments, so /tool never matches /tool-other. */
export function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
