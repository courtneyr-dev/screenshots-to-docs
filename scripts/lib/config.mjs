/**
 * Shared configuration for the P1 editor screenshot tool.
 *
 * One JSON file holds every per-run input: the P1 base URL, project and workstream names, the page
 * being edited, the Chrome profile and debugging port, the Figma destination and naming, and where
 * the docs handoff note goes. Nothing here has a project-specific default.
 *
 * validateConfig() reports every problem at once, before any browser opens. The config file must
 * never hold credentials, cookies, tokens, or storage state, and validation rejects keys that look
 * like them.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { canonicalPath, isInside } from './paths.mjs';

export const TOOL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const KNOWN_KEYS = new Set([
  '$comment', 'topic', 'baseUrl', 'editorRoute', 'projectName', 'workstream', 'pagePath',
  'pageNavigation', 'pageLabel', 'blockCategory', 'blockType', 'blockSelector', 'publishMenuLabel', 'chrome', 'figma', 'docs',
]);
const KNOWN_CHROME = new Set(['profileDir', 'cdpPort']);
const KNOWN_FIGMA = new Set(['fileKey', 'pageNamePattern', 'runIdPattern']);
const KNOWN_DOCS = new Set(['handoffDir', 'format']);

// Keys that suggest someone is about to put a secret in the config.
const SECRET_KEY = /pass(word|wd)?|secret|token|cookie|credential|storage.?state|api.?key|session/i;

export const DEFAULTS = {
  editorRoute: '/p1',
  publishMenuLabel: 'Publish this page to',
  blockCategory: 'P1 Layout',
  pageNamePattern: '{topic} · {datetime} · {runId}',
  runIdPattern: '{topic}-{yyyymmdd}-{hhmm}',
  docsFormat: 'markdown',
};

export const PAGE_NAME_TOKENS = ['topic', 'date', 'time', 'datetime', 'runId', 'project', 'workstream', 'release'];
export const RUN_ID_TOKENS = ['topic', 'yyyymmdd', 'hhmm'];

export function expandHome(p) {
  if (typeof p !== 'string') return p;
  return p === '~' ? homedir() : p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p;
}

export function loadConfig(file) {
  const path = resolve(expandHome(file));
  if (!existsSync(path)) {
    throw new Error(`config file not found: ${path}. Copy examples/config.example.json, fill it in, and pass --config <file>.`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new Error(`config file ${path} is not valid JSON: ${e.message}`);
  }
}

// --set chrome.cdpPort=9333 style overrides. Numbers stay numbers.
export function applyOverrides(cfg, sets = []) {
  const out = JSON.parse(JSON.stringify(cfg || {}));
  for (const s of sets) {
    const i = s.indexOf('=');
    if (i < 1) throw new Error(`--set expects key=value, got "${s}"`);
    const keys = s.slice(0, i).split('.');
    let v = s.slice(i + 1);
    if (/^\d+$/.test(v)) v = Number(v);
    let o = out;
    for (const k of keys.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {};
    o[keys.at(-1)] = v;
  }
  return out;
}

function isPlaceholder(v) {
  return typeof v === 'string' && (/^<.*>$/.test(v.trim()) || /\b(TODO|REPLACE_ME|CHANGEME)\b/i.test(v) || v.includes('{{'));
}

function insideGitWorktree(dir) {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(resolve(d, '.git'))) return d;
    if (dirname(d) === d) return null;
  }
}

function tokensIn(pattern) {
  return [...pattern.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
}

/**
 * Returns { errors: [{ key, message }], warnings: [string] }.
 * stages: which parts of the workflow this run needs: 'capture', 'figma', 'handoff'.
 */
export function validateConfig(cfg, stages = ['capture']) {
  const errors = [];
  const warnings = [];
  const err = (key, message) => errors.push({ key, message });
  // Resolve symlinks before any containment check. A path that cannot be resolved is an error, not a pass.
  const realPathOrError = (key, p) => {
    try { return canonicalPath(p); } catch (e) { err(key, e.message); return null; }
  };
  const need = s => stages.includes(s);

  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return { errors: [{ key: '(config)', message: 'config must be a JSON object' }], warnings };
  }

  // Structure: unknown keys catch typos; secret-looking keys are refused at any depth.
  const walk = (obj, path) => {
    for (const [k, v] of Object.entries(obj)) {
      const full = path ? `${path}.${k}` : k;
      if (SECRET_KEY.test(k)) err(full, 'looks like a credential. Never put passwords, cookies, tokens, or storage state in the config; sign in interactively in the dedicated Chrome window.');
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, full);
    }
  };
  walk(cfg, '');
  for (const k of Object.keys(cfg)) if (!KNOWN_KEYS.has(k)) err(k, 'unknown key (check the spelling against examples/config.example.json)');
  for (const [sect, known] of [['chrome', KNOWN_CHROME], ['figma', KNOWN_FIGMA], ['docs', KNOWN_DOCS]]) {
    if (cfg[sect] === undefined) continue;
    if (!cfg[sect] || typeof cfg[sect] !== 'object' || Array.isArray(cfg[sect])) {
      err(sect, 'must be an object');
      continue;
    }
    for (const k of Object.keys(cfg[sect])) if (!known.has(k)) err(`${sect}.${k}`, 'unknown key');
  }

  const str = (key, value, { required, pattern, what } = {}) => {
    if (value === undefined || value === null || value === '') {
      if (required) err(key, `missing. ${what || 'Set it in the config file.'}`);
      return false;
    }
    if (typeof value !== 'string') { err(key, 'must be a string'); return false; }
    if (isPlaceholder(value)) { err(key, `still a placeholder ("${value}"). Replace it with a real value.`); return false; }
    if ([...value].some(ch => ch.charCodeAt(0) < 32) || value.length > 200) { err(key, 'contains control characters or is over 200 characters'); return false; }
    if (pattern && !pattern.test(value)) { err(key, `invalid value "${value}"`); return false; }
    return true;
  };

  if (need('capture')) {
    str('topic', cfg.topic, { required: true, pattern: /^[a-z0-9][a-z0-9-]*$/, what: 'A short kebab-case name for this set of screenshots, used in run IDs and Figma page names.' });
    if (str('baseUrl', cfg.baseUrl, { required: true, what: 'The P1 site origin, for example http://localhost:3000.' })) {
      try {
        const u = new URL(cfg.baseUrl);
        if (!/^https?:$/.test(u.protocol)) err('baseUrl', 'must start with http:// or https://');
        if (u.username || u.password) err('baseUrl', 'must not contain a username or password');
        if (u.search || u.hash) err('baseUrl', 'must be an origin (no query string or fragment)');
      } catch { err('baseUrl', `not a valid URL: ${cfg.baseUrl}`); }
    }
    str('projectName', cfg.projectName, { required: true, what: 'The project or site name as the editor header shows it. Find it with the P1 MCP (list_sites) or in the editor.' });
    str('workstream', cfg.workstream, { required: true, what: 'The workstream to show, as the editor\'s workstream selector lists it. Choose it for each run (P1 MCP list_branches); there is no default.' });
    if (str('pagePath', cfg.pagePath, { required: true, what: 'The page being edited, for example "/" or "/about" (P1 MCP list_documents).' }) && !/^\/\S*$/.test(cfg.pagePath)) {
      err('pagePath', 'must start with "/" and contain no spaces');
    }
    if (cfg.pageNavigation !== undefined && !['url', 'manual'].includes(cfg.pageNavigation)) err('pageNavigation', `must be "url" (open the page through the editor URL) or "manual" (open the editor route only; you select the page) (got ${JSON.stringify(cfg.pageNavigation)})`);
    if (cfg.pageLabel !== undefined) str('pageLabel', cfg.pageLabel);
    if (cfg.blockCategory !== undefined) str('blockCategory', cfg.blockCategory);
    if (cfg.editorRoute !== undefined && !(typeof cfg.editorRoute === 'string' && /^\/\S*$/.test(cfg.editorRoute))) err('editorRoute', 'must start with "/" (default "/p1")');
    if (cfg.blockType !== undefined) str('blockType', cfg.blockType, { pattern: /^[A-Za-z][A-Za-z0-9_]*$/ });
    if (cfg.blockSelector !== undefined) str('blockSelector', cfg.blockSelector);
    if (cfg.blockType && cfg.blockSelector) err('blockType', 'set blockType or blockSelector, not both');
    if (!cfg.blockType && !cfg.blockSelector) warnings.push('No blockType or blockSelector: the shots that select a block will be skipped and reported as skipped.');
    if (cfg.publishMenuLabel !== undefined) str('publishMenuLabel', cfg.publishMenuLabel);

    const ch = cfg.chrome;
    if (!ch || typeof ch !== 'object') {
      err('chrome.profileDir', 'missing. Choose a dedicated, empty directory outside any repository for the sign-in profile.');
      err('chrome.cdpPort', 'missing. Choose a free local port for the Chrome debugging endpoint.');
    } else {
      if (str('chrome.profileDir', ch.profileDir, { required: true, what: 'A dedicated directory outside any repository. Never the regular Chrome profile.' })) {
        const p = resolve(expandHome(ch.profileDir));
        if (!/^\//.test(p)) err('chrome.profileDir', 'must be an absolute path (or start with ~/)');
        if (/Google\/Chrome(\/Default|\/Profile \d+)?\/?$/i.test(p) || /Library\/Application Support\/Google\/Chrome/i.test(p) || /\.config\/google-chrome/i.test(p)) {
          err('chrome.profileDir', 'is (or is inside) the regular Chrome profile. Use a separate directory: Chrome refuses a debugging port on the default profile, and it holds real sessions.');
        }
        const real = realPathOrError('chrome.profileDir', p);
        if (real) {
          if (isInside(real, canonicalPath(TOOL_DIR))) err('chrome.profileDir', 'is inside this tool\'s directory (checked after resolving symlinks). A browser profile must never sit where it could be committed.');
          const repo = insideGitWorktree(real);
          if (repo) err('chrome.profileDir', `is inside a git repository (${repo}). A browser profile holds a login and must stay outside every repository.`);
        }
      }
      const port = ch.cdpPort;
      if (port === undefined || port === null || port === '') err('chrome.cdpPort', 'missing. Choose a free local port for the Chrome debugging endpoint.');
      else if (!Number.isInteger(port) || port < 1024 || port > 65535) err('chrome.cdpPort', `must be an integer from 1024 to 65535 (got ${JSON.stringify(port)})`);
    }
  }

  if (need('figma')) {
    const f = cfg.figma || {};
    if (!cfg.figma) err('figma.fileKey', 'missing. Set the destination design file key (the :fileKey in figma.com/design/:fileKey/…).');
    else if (str('figma.fileKey', f.fileKey, { required: true, what: 'The destination design file key.' }) && !/^[0-9a-zA-Z]{22,128}$/.test(f.fileKey)) {
      err('figma.fileKey', 'does not look like a Figma file key (22 to 128 letters and digits, from figma.com/design/<fileKey>/…)');
    }
    if (f.pageNamePattern !== undefined && str('figma.pageNamePattern', f.pageNamePattern)) {
      for (const t of tokensIn(f.pageNamePattern)) if (!PAGE_NAME_TOKENS.includes(t)) err('figma.pageNamePattern', `unknown token {${t}}. Allowed: ${PAGE_NAME_TOKENS.map(x => `{${x}}`).join(' ')}`);
      if (!f.pageNamePattern.includes('{runId}')) err('figma.pageNamePattern', 'must include {runId}: the page name is how a repeat push of the same run is detected');
    }
    if (f.runIdPattern !== undefined && str('figma.runIdPattern', f.runIdPattern)) {
      for (const t of tokensIn(f.runIdPattern)) if (!RUN_ID_TOKENS.includes(t)) err('figma.runIdPattern', `unknown token {${t}}. Allowed: ${RUN_ID_TOKENS.map(x => `{${x}}`).join(' ')}`);
      if (!/\{yyyymmdd\}/.test(f.runIdPattern) || !/\{hhmm\}/.test(f.runIdPattern)) err('figma.runIdPattern', 'must include {yyyymmdd} and {hhmm} so each run gets a distinct ID');
    }
  }

  if (need('handoff')) {
    const d = cfg.docs || {};
    if (!cfg.docs) err('docs.handoffDir', 'missing. Set the directory where handoff notes are written.');
    else if (str('docs.handoffDir', d.handoffDir, { required: true, what: 'The directory where handoff notes are written.' })) {
      const p = resolve(expandHome(d.handoffDir));
      const real = realPathOrError('docs.handoffDir', p);
      if (real) {
        if (isInside(real, canonicalPath(TOOL_DIR))) err('docs.handoffDir', 'is inside this tool\'s directory (checked after resolving symlinks). Write handoff notes where the docs author will look for them.');
        else if (insideGitWorktree(real)) warnings.push(`docs.handoffDir is inside a git repository (${insideGitWorktree(real)}). Review the note before committing it: it names the project, workstream, and Figma file.`);
      }
    }
    if (d.format !== undefined && !['markdown', 'json'].includes(d.format)) err('docs.format', `must be "markdown" or "json" (got ${JSON.stringify(d.format)})`);
  }

  return { errors, warnings };
}

export function formatValidation({ errors, warnings }, label = 'Configuration') {
  const lines = [];
  if (errors.length) {
    lines.push(`${label} is not ready: ${errors.length} problem${errors.length === 1 ? '' : 's'}.`);
    for (const e of errors) lines.push(`  ✗ ${e.key}: ${e.message}`);
  } else lines.push(`${label} OK.`);
  for (const w of warnings) lines.push(`  ! ${w}`);
  return lines.join('\n');
}

// The editor mounts pages under its route: /p1 edits "/", and /p1/about edits "/about" (read from the
// p1-next-sdk path mapping). "manual" opens the route only and leaves page selection to the person.
export function editorUrlFor(cfg) {
  const route = (cfg.editorRoute || DEFAULTS.editorRoute).replace(/\/+$/, '');
  if (cfg.pageNavigation === 'manual' || !cfg.pagePath || cfg.pagePath === '/') return route;
  return `${route}${cfg.pagePath.replace(/\/+$/, '')}`;
}

// Flat values for {{placeholders}} in briefs and templates.
export function deriveParams(cfg) {
  const p = {
    topic: cfg.topic,
    baseUrl: cfg.baseUrl,
    editorRoute: cfg.editorRoute || DEFAULTS.editorRoute,
    projectName: cfg.projectName,
    workstream: cfg.workstream,
    pagePath: cfg.pagePath,
    editorUrl: editorUrlFor(cfg),
    pageLabel: cfg.pageLabel || cfg.pagePath,
    blockCategory: cfg.blockCategory || DEFAULTS.blockCategory,
    blockType: cfg.blockType,
    blockSelector: cfg.blockSelector,
    publishMenuLabel: cfg.publishMenuLabel || DEFAULTS.publishMenuLabel,
    cdpPort: cfg.chrome?.cdpPort,
    connectUrl: cfg.chrome?.cdpPort ? `http://127.0.0.1:${cfg.chrome.cdpPort}` : undefined,
  };
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== ''));
}

// Replace {{key}} in every string. Returns the new value and the names that had no value.
export function applyParams(value, params) {
  const unresolved = new Set();
  const walk = v => {
    if (typeof v === 'string') return v.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in params ? String(params[k]) : (unresolved.add(k), m)));
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), unresolved: [...unresolved] };
}

export function placeholdersIn(value) {
  const found = new Set();
  const walk = v => {
    if (typeof v === 'string') for (const m of v.matchAll(/\{\{(\w+)\}\}/g)) found.add(m[1]);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return [...found];
}

const pad = n => String(n).padStart(2, '0');

export function runIdFor(capturedAt, topic, pattern = DEFAULTS.runIdPattern) {
  const d = new Date(capturedAt);
  const t = { topic, yyyymmdd: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`, hhmm: `${pad(d.getHours())}${pad(d.getMinutes())}` };
  return pattern.replace(/\{(\w+)\}/g, (m, k) => (k in t ? t[k] : m));
}

export function pageNameFor({ capturedAt, topic, runId, project = '', workstream = '', release = '' }, pattern = DEFAULTS.pageNamePattern) {
  const d = new Date(capturedAt);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const t = { topic, date, time, datetime: `${date} ${time}`, runId, project, workstream, release };
  return pattern.replace(/\{(\w+)\}/g, (m, k) => (k in t ? t[k] : m));
}
