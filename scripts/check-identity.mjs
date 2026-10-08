#!/usr/bin/env node
/**
 * p1-editor-screenshots / check-identity
 *
 * Fails when a personal email address would reach the repository, in either place git records one:
 *   1. commit metadata: the author and committer email of every commit in a range, and any email written
 *      in a commit message (trailers such as Co-Authored-By);
 *   2. tracked files: any email-like string under the tool folder.
 *
 * An address passes when it matches --allow (default: Pantheon addresses and GitHub noreply addresses) or
 * is one of the always-allowed placeholders (example.com / example.org, and the noreply attribution
 * trailer). Everything else is reported and the command exits 1.
 *
 * Usage:
 *   node check-identity.mjs --range origin/main..HEAD            # commit metadata and messages
 *   node check-identity.mjs --files                              # tracked files in the current directory
 *   node check-identity.mjs --range origin/main..HEAD --files --allow '@pantheon\.io$|@users\.noreply\.github\.com$'
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    range: { type: 'string' },
    files: { type: 'boolean' },
    allow: { type: 'string', default: '@pantheon\\.io$|@users\\.noreply\\.github\\.com$' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || (!values.range && !values.files)) {
  console.log("Usage: node check-identity.mjs [--range <git range>] [--files] [--allow '<regex>']");
  process.exit(values.help ? 0 : 1);
}

const allow = new RegExp(`${values.allow}|@example\\.(com|org)$|^noreply@anthropic\\.com$`, 'i');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const bad = [];

const git = args => {
  const r = spawnSync('git', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { console.error(`FAIL: git ${args.join(' ')}: ${r.stderr.trim()}`); process.exit(1); }
  return r.stdout;
};

if (values.range) {
  const SEP = '\u001e';
  const out = git(['log', values.range, `--format=%H${SEP}%ae${SEP}%ce${SEP}%B${SEP}END`]);
  for (const rec of out.split(`${SEP}END\n`).filter(Boolean)) {
    const [hash, ae, ce, msg] = rec.split(SEP);
    const h = hash.trim().slice(0, 9);
    for (const [where, e] of [['author', ae], ['committer', ce]]) if (!allow.test(e.trim())) bad.push(`commit ${h} ${where} email: ${e.trim()}`);
    for (const m of (msg || '').matchAll(EMAIL)) if (!allow.test(m[0])) bad.push(`commit ${h} message: ${m[0]}`);
  }
}

if (values.files) {
  for (const f of git(['ls-files', '-z', '--', '.']).split('\0').filter(Boolean)) {
    if (/package-lock\.json$/.test(f)) continue;
    let text;
    try { text = readFileSync(f, 'utf-8'); } catch { continue; }
    for (const m of text.matchAll(EMAIL)) if (!allow.test(m[0])) bad.push(`${f}: ${m[0]}`);
  }
}

if (bad.length) {
  console.error(`FAIL: ${bad.length} email address${bad.length === 1 ? '' : 'es'} outside the allowed set (${values.allow}):`);
  for (const b of [...new Set(bad)]) console.error(`  ${b}`);
  console.error('Use a Pantheon or GitHub noreply address for commits, and remove personal addresses from files. Rewrite only your own unpushed commits.');
  process.exit(1);
}
console.log('Identity check OK: no personal email in the checked commit metadata, messages, or files.');
