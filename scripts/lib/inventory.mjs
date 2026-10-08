/**
 * Screenshot inventory: the git-tracked, canonical list of screenshots the P1 docs need.
 *
 * One JSON file (default inventory/screenshots.json) holds { version, records }. A record says why a
 * screenshot exists, what UI state to capture, which Figma frame reviewed it, which docs article and
 * image slot it replaces, and what was verified once published. This module validates records,
 * enforces the lifecycle, and derives everything else (capture briefs, asset paths, Figma frame names,
 * handoff reports, reverse lookups). It never contacts Figma or Google, and it never invents values:
 * a field that was not recorded is reported as unverified.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, basename, relative } from 'node:path';

export const SCHEMA_VERSION = 1;
export const STATUSES = ['proposed', 'approved', 'captured', 'annotated', 'handed_off', 'inserted', 'verified', 'retired'];
export const RELEASE_STATUSES = ['unchanged', 'refresh', 'new', 'retire'];
export const PRIORITIES = ['required', 'recommended', 'optional'];
export const SOURCE_TYPES = ['docs', 'issue', 'pr', 'release', 'support', 'design', 'other'];
export const FIGMA_EVIDENCE = ['none', 'planned', 'uploaded', 'verified', 'not_used'];
export const ANNOTATION_STATUS = ['none', 'in_progress', 'complete'];

const RANK = Object.fromEntries(STATUSES.map((s, i) => [s, i]));
const FLOW = ['proposed', 'approved', 'captured', 'annotated', 'handed_off', 'inserted', 'verified'];

export const ID_RE = /^[a-z][a-z0-9]*(\.[a-z0-9]+(-[a-z0-9]+)*){1,4}$/;
export const RELEASE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{7,40}$/;

const KEYS = {
  record: ['screenshot_id', 'title', 'status', 'release_status', 'priority', 'owner', 'reviewer', 'source', 'capture', 'content', 'figma', 'asset', 'publication', 'history', 'retired_at', 'retired_reason', 'notes'],
  source: ['type', 'docs_url', 'docs_document_id', 'docs_heading', 'request_url', 'reason'],
  capture: ['project', 'workstream', 'page', 'release', 'state', 'actions', 'checks', 'constraints'],
  content: ['caption', 'alt_text', 'annotations'],
  figma: ['evidence', 'not_used_reason', 'file_url', 'page_name', 'frame_name', 'annotated_frame_name', 'node_id', 'annotated_node_id', 'version_name', 'branch_url', 'dev_resource_urls', 'manifest_commit', 'annotation_status'],
  asset: ['path', 'sha256', 'width', 'height', 'captured_at', 'source'],
  publication: ['docs_image_slot', 'published_url', 'published_sha256', 'alt_text_fingerprint', 'inserted_at', 'verified_at', 'verified_release', 'verified_asset_sha256', 'verification_notes'],
};

// ---------------------------------------------------------------- derived values

export const sha256 = buf => createHash('sha256').update(buf).digest('hex');

/** Normalized fingerprint of alt text: what a person compares against the published image's alt. */
export function altFingerprint(alt) {
  const norm = String(alt ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return sha256(norm).slice(0, 16);
}

export const assetPath = (id, release) => `screenshots/${id}/${release}.png`;

export function shortTitle(r) {
  if (r.title) return r.title;
  const last = String(r.screenshot_id || '').split('.').pop() || '';
  return last.replace(/-/g, ' ');
}

/** Figma frame names: "[id] — short title — release — kind". The annotated frame goes to the docs; the clean frame stays in Figma as the unannotated capture. */
export function frameName(r, kind = 'clean') {
  return `[${r.screenshot_id}] — ${shortTitle(r)} — ${r.capture?.release || 'unreleased'} — ${kind}`;
}

export function pngInfo(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buf.length < 24 || sig.some((b, i) => buf[i] !== b)) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export const isActive = r => r.status !== 'retired' && r.release_status !== 'retire';

export function docKey(r) {
  const s = r.source || {};
  const id = (s.docs_document_id || '').trim();
  if (id) return `id:${id}`;
  const url = (s.docs_url || '').trim().replace(/[#?].*$/, '').replace(/\/+$/, '');
  return url ? `url:${url.toLowerCase()}` : '';
}

export function anchorKey(r) {
  const heading = (r.source?.docs_heading || '').trim().toLowerCase();
  const slot = (r.publication?.docs_image_slot || '').trim().toLowerCase();
  return `${docKey(r)}|${heading}|${slot}`;
}

/** The manual anchor used to find the image later: document + heading + slot + caption + alt fingerprint. */
export function composeAnchor(r) {
  const slot = r.publication?.docs_image_slot || '';
  const m = slot.match(/#(\d+)\s*$/);
  return {
    document_id: r.source?.docs_document_id || null,
    document_url: r.source?.docs_url || null,
    heading: r.source?.docs_heading || null,
    image_slot: slot || null,
    image_ordinal: m ? Number(m[1]) : null,
    caption: r.content?.caption ?? null,
    alt_text_fingerprint: r.content?.alt_text ? altFingerprint(r.content.alt_text) : null,
  };
}

// ---------------------------------------------------------------- loading and writing

export function loadInventory(file) {
  let text;
  try { text = readFileSync(file, 'utf-8'); } catch (e) { throw new Error(`cannot read inventory ${file}: ${e.message}`); }
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new Error(`inventory ${file} is not valid JSON: ${e.message}`); }
  return { file, doc };
}

export function writeInventory(file, doc) {
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
}

/** Commit that last touched the inventory file, and whether it has uncommitted changes. */
export function inventoryCommit(file) {
  try {
    const cwd = dirname(file);
    const run = args => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const commit = run(['log', '-1', '--format=%H', '--', basename(file)]);
    const dirty = run(['status', '--porcelain', '--', basename(file)]) !== '';
    return { commit: commit || null, dirty };
  } catch {
    return { commit: null, dirty: false };
  }
}

export function inventoryAtRef(file, ref) {
  const cwd = dirname(file);
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf-8' }).trim();
  const rel = relative(top, file);
  const text = execFileSync('git', ['show', `${ref}:${rel}`], { cwd: top, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(text);
}

// ---------------------------------------------------------------- text and secret checks

const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, 'an AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'a GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\bfigd_[A-Za-z0-9_-]{20,}/, 'a Figma token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, 'a JWT'],
  [/\bBearer\s+[A-Za-z0-9._-]{16,}/i, 'a bearer token'],
  [/\b(api[_-]?key|secret|token|password|passwd|cookie|authorization)\s*[:=]\s*\S{6,}/i, 'a credential assignment'],
  [/[?&](token|access_token|sig|signature|x-amz-signature|api_key|key)=[^&\s]{6,}/i, 'a signed or tokenized URL'],
  [/\bhttps?:\/\/[^\s/@]+:[^\s/@]+@/i, 'a URL with credentials'],
  [/\b[A-Za-z0-9._%+-]+@(?!example\.(com|org)\b)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+\b/, 'an email address (use a person or team handle)'],
];

function* strings(v, path) {
  if (typeof v === 'string') yield [path, v];
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* strings(v[i], `${path}[${i}]`);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) yield* strings(x, path ? `${path}.${k}` : k);
}

const PLACEHOLDER_RE = /\b(TO FILL|TODO|TBD|FIXME|lorem ipsum|placeholder|alt text here|insert (alt|caption))\b|\{\{|\}\}|<[a-z][a-z -]*>/i;
const TEST_DATA_RE = /\b(lorem|dummy|test data|foo ?bar|sample text|asdf)\b/i;
const GENERIC_ALT = new Set(['screenshot', 'image', 'picture', 'photo', 'p1 editor', 'p1 editor screenshot', 'editor', 'screenshot of the p1 editor', 'screenshot of the editor']);

/** Problems in a caption or alt text. Returns { errors, warnings }. */
export function checkText(kind, text, ownId, allIds = []) {
  const errors = [], warnings = [];
  if (typeof text !== 'string' || !text.trim()) return { errors: [`${kind} is missing`], warnings };
  if (text !== text.trim()) errors.push(`${kind} has leading or trailing whitespace`);
  if (/[\n\r|]/.test(text)) errors.push(`${kind} must be one line with no "|" (it is copied into tables unchanged)`);
  if (PLACEHOLDER_RE.test(text)) errors.push(`${kind} contains placeholder text`);
  if (TEST_DATA_RE.test(text)) errors.push(`${kind} contains test or filler data`);
  if (/\bhttps?:\/\/|\blocalhost\b|127\.0\.0\.1|\/Users\/|~\//i.test(text)) errors.push(`${kind} contains a URL, host, or local path`);
  for (const id of new Set([ownId, ...allIds].filter(Boolean))) if (text.includes(id)) errors.push(`${kind} contains the inventory ID "${id}"`);
  if (kind === 'alt_text') {
    const norm = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (GENERIC_ALT.has(norm) || norm.split(' ').length < 4) errors.push('alt_text is too generic to describe the image (say what the image shows and why)');
    if (/^(an? |the )?(image|picture|screenshot|photo|graphic) (of|showing)\b/i.test(text)) warnings.push('alt_text starts with "image of/screenshot of"; screen readers already announce an image');
    if (text.length > 250) warnings.push('alt_text is over 250 characters; consider moving detail into the caption');
  } else if (text.length > 300) warnings.push('caption is over 300 characters');
  return { errors, warnings };
}

// ---------------------------------------------------------------- gates and validation

const nonEmpty = v => typeof v === 'string' && v.trim() !== '';
const isHttps = v => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };
const isUrl = v => { try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };

/**
 * Requirements a record must meet to be at `status`. Cumulative: a record at "verified" meets every
 * earlier gate. Returns [{ field, message }].
 */
export function gateErrors(r, status, ctx = {}) {
  const out = [];
  const need = (field, ok, message) => { if (!ok) out.push({ field, message }); };
  const rank = RANK[status];
  const s = r.source || {}, c = r.capture || {}, ct = r.content || {}, f = r.figma || {}, a = r.asset || {}, p = r.publication || {};

  if (rank >= RANK.approved && status !== 'retired') {
    need('reviewer', nonEmpty(r.reviewer), 'a reviewer is required before approval');
    need('source.type', SOURCE_TYPES.includes(s.type), `source.type must be one of ${SOURCE_TYPES.join('|')}`);
    need('source.reason', nonEmpty(s.reason), 'source.reason (the documentation claim or task this image explains) is required');
    need('source.docs_heading', nonEmpty(s.docs_heading), 'source.docs_heading (exact heading the image belongs under) is required');
    need('source.docs_document_id', nonEmpty(s.docs_document_id) || nonEmpty(s.docs_url), 'a documentation destination is required: source.docs_document_id or source.docs_url');
    need('publication.docs_image_slot', nonEmpty(p.docs_image_slot), 'publication.docs_image_slot (heading + image ordinal, or a stable anchor) is required');
    if (['issue', 'pr', 'release', 'support'].includes(s.type)) need('source.request_url', isUrl(s.request_url || ''), `source.request_url is required for a ${s.type} request`);
  }
  if (rank >= RANK.captured && status !== 'retired') {
    for (const k of ['project', 'workstream', 'state']) need(`capture.${k}`, nonEmpty(c[k]), `capture.${k} is required to reproduce the screenshot`);
    need('capture.page', nonEmpty(c.page) && c.page.startsWith('/'), 'capture.page must be a route starting with "/"');
    need('capture.release', nonEmpty(c.release) && RELEASE_RE.test(c.release), 'capture.release must be a release or commit identifier (letters, digits, ".", "_", "-")');
    need('capture.actions', Array.isArray(c.actions), 'capture.actions must be a list (it can be empty: the editor-ready and workstream steps are added for every shot)');
    need('capture.checks', Array.isArray(c.checks) && c.checks.length > 0, 'capture.checks must list at least one check that fails when the state is wrong');
    need('asset.path', nonEmpty(a.path) && a.path === assetPath(r.screenshot_id, c.release), `asset.path must be ${assetPath(r.screenshot_id, c.release || '<release>')}`);
    need('asset.sha256', SHA_RE.test(a.sha256 || ''), 'asset.sha256 must be a 64-character hex checksum of the exported PNG');
    need('asset.width', Number.isInteger(a.width) && a.width > 0, 'asset.width must be a positive integer');
    need('asset.height', Number.isInteger(a.height) && a.height > 0, 'asset.height must be a positive integer');
    need('asset.captured_at', ISO_RE.test(a.captured_at || ''), 'asset.captured_at must be an ISO timestamp');
  }
  if (rank >= RANK.annotated && status !== 'retired') {
    const ev = f.evidence || 'none';
    if (ev === 'not_used') {
      need('figma.not_used_reason', nonEmpty(f.not_used_reason), 'figma.not_used_reason is required when Figma is not part of this screenshot\'s review');
    } else {
      need('figma.evidence', ev === 'uploaded' || ev === 'verified', `figma.evidence is "${ev}"; annotation needs "uploaded" or "verified" (or "not_used" with a reason)`);
      need('figma.file_url', isHttps(f.file_url || ''), 'figma.file_url is required once the image is in Figma');
      need('figma.node_id', nonEmpty(f.node_id), 'figma.node_id is required once the image is in Figma');
      need('figma.frame_name', f.frame_name === frameName(r, 'clean'), `figma.frame_name must be "${frameName(r, 'clean')}"`);
      need('figma.annotation_status', f.annotation_status === 'complete', 'figma.annotation_status must be "complete" before the record is "annotated"');
    }
  }
  if (rank >= RANK.handed_off && status !== 'retired') {
    for (const [kind, key] of [['caption', 'caption'], ['alt_text', 'alt_text']]) {
      const t = checkText(kind, ct[key], r.screenshot_id, ctx.allIds || []);
      for (const m of t.errors) out.push({ field: `content.${key}`, message: m });
    }
    if ((f.evidence || 'none') === 'verified') {
      need('figma.version_name', nonEmpty(f.version_name), 'figma.version_name (the named version at approval) is required for verified Figma evidence');
      need('figma.manifest_commit', COMMIT_RE.test(f.manifest_commit || ''), 'figma.manifest_commit must be a git commit');
    }
  }
  if (rank >= RANK.inserted && status !== 'retired') {
    need('asset.sha256', SHA_RE.test(a.sha256 || ''), 'asset.sha256 is required before insertion');
    need('publication.inserted_at', ISO_RE.test(p.inserted_at || ''), 'publication.inserted_at must be an ISO timestamp');
  }
  if (rank >= RANK.verified && status !== 'retired') {
    need('publication.published_url', isHttps(p.published_url || ''), 'publication.published_url (the public image URL) must be an https URL');
    need('publication.published_sha256', SHA_RE.test(p.published_sha256 || ''), 'publication.published_sha256 (sha256 of the bytes published_url serves) is required; it may differ from asset.sha256 because publishing can resize or re-encode the image');
    need('publication.verified_at', ISO_RE.test(p.verified_at || ''), 'publication.verified_at must be an ISO timestamp');
    need('publication.verified_release', nonEmpty(p.verified_release), 'publication.verified_release is required');
    need('publication.alt_text_fingerprint', p.alt_text_fingerprint === altFingerprint(ct.alt_text), `publication.alt_text_fingerprint must be ${altFingerprint(ct.alt_text)} (the fingerprint of the current alt_text)`);
    need('publication.verified_release', !nonEmpty(p.verified_release) || p.verified_release === c.release, `publication.verified_release is "${p.verified_release}" but capture.release is "${c.release}"; the published image is stale`);
    need('publication.verified_asset_sha256', p.verified_asset_sha256 === a.sha256, 'publication.verified_asset_sha256 must equal asset.sha256 (it records which capture was inserted and verified; a new capture makes the publication stale)');
  }
  return out;
}

export const nextStatus = s => FLOW[FLOW.indexOf(s) + 1] || null;

/** Allowed lifecycle moves: one step forward, back to approved (re-capture or reopen), withdraw to proposed, or retire. */
export function transitionError(from, to) {
  if (!STATUSES.includes(from) || !STATUSES.includes(to)) return `unknown status "${from}" -> "${to}"`;
  if (from === to) return null;
  if (from === 'retired') return 'a retired record cannot be reactivated; create a new record if the concept returns';
  if (to === 'retired') return null;
  if (FLOW.indexOf(to) === FLOW.indexOf(from) + 1) return null;
  if (to === 'approved' && RANK[from] > RANK.approved) return null;
  if (to === 'proposed' && from === 'approved') return null;
  return `"${from}" -> "${to}" is not allowed (move one step at a time: ${FLOW.join(' -> ')}; "approved" can be re-entered to re-capture; any status can become "retired")`;
}

export function publicationHealth(r) {
  if (r.status === 'retired') return { state: 'retired', reasons: [] };
  const p = r.publication || {}, a = r.asset || {};
  if (r.status !== 'verified') return { state: 'unverified', reasons: [`status is ${r.status}`] };
  const unverifiable = [], stale = [];
  if (!isHttps(p.published_url || '')) unverifiable.push('no https published_url');
  if (!SHA_RE.test(p.published_sha256 || '')) unverifiable.push('no published_sha256');
  if (!ISO_RE.test(p.verified_at || '')) unverifiable.push('no verified_at');
  if (!docKey(r)) unverifiable.push('no docs document ID or URL');
  if (!nonEmpty(p.docs_image_slot)) unverifiable.push('no docs_image_slot');
  if (unverifiable.length) return { state: 'unverifiable', reasons: unverifiable };
  if (p.alt_text_fingerprint !== altFingerprint(r.content?.alt_text)) stale.push('alt text changed since verification');
  if (p.verified_release !== r.capture?.release) stale.push(`verified for ${p.verified_release}, capture is ${r.capture?.release}`);
  if (p.verified_asset_sha256 !== a.sha256) stale.push('asset checksum differs from the verified image');
  return stale.length ? { state: 'stale', reasons: stale } : { state: 'verified', reasons: [] };
}

function shapeErrors(r, add) {
  for (const k of Object.keys(r)) if (!KEYS.record.includes(k)) add('', `unknown field "${k}"`);
  for (const sec of ['source', 'capture', 'content', 'figma', 'asset', 'publication']) {
    const v = r[sec];
    if (v === undefined) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) { add(sec, `${sec} must be an object`); continue; }
    for (const k of Object.keys(v)) if (!KEYS[sec].includes(k)) add(`${sec}.${k}`, `unknown field "${k}"`);
  }
  for (const [path, key] of [['capture.actions', r.capture?.actions], ['capture.checks', r.capture?.checks], ['capture.constraints', r.capture?.constraints], ['content.annotations', r.content?.annotations], ['figma.dev_resource_urls', r.figma?.dev_resource_urls], ['history', r.history]]) {
    if (key !== undefined && !Array.isArray(key)) add(path, `${path} must be a list`);
  }
}

/**
 * Validate a whole inventory. `previous` (an earlier inventory document) enables transition checks.
 * Returns { errors, warnings }, each [{ id, field, message }].
 */
export function validateInventory(doc, { previous = null } = {}) {
  const errors = [], warnings = [];
  const push = (list, id, field, message) => list.push({ id, field, message });
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { errors: [{ id: '(file)', field: '', message: 'inventory must be an object with "version" and "records"' }], warnings };
  for (const k of Object.keys(doc)) if (!['$comment', 'version', 'records'].includes(k)) push(errors, '(file)', k, `unknown top-level field "${k}"`);
  if (doc.version !== SCHEMA_VERSION) push(errors, '(file)', 'version', `version must be ${SCHEMA_VERSION}`);
  if (!Array.isArray(doc.records)) { push(errors, '(file)', 'records', 'records must be a list'); return { errors, warnings }; }

  const ids = doc.records.map(r => r?.screenshot_id).filter(nonEmpty);
  const seen = new Map(), anchors = new Map();
  doc.records.forEach((r, i) => {
    const id = r && nonEmpty(r.screenshot_id) ? r.screenshot_id : `records[${i}]`;
    const err = (field, message) => push(errors, id, field, message);
    if (!r || typeof r !== 'object' || Array.isArray(r)) return err('', 'record must be an object');
    shapeErrors(r, err);
    if (!nonEmpty(r.screenshot_id) || !ID_RE.test(r.screenshot_id)) err('screenshot_id', 'screenshot_id must look like "p1.topic.short-purpose" (lowercase letters, digits, "-", dot-separated, 2 to 5 parts)');
    else if (seen.has(r.screenshot_id)) err('screenshot_id', `duplicate screenshot_id (also records[${seen.get(r.screenshot_id)}])`);
    else seen.set(r.screenshot_id, i);
    if (!STATUSES.includes(r.status)) err('status', `status must be one of ${STATUSES.join('|')}`);
    if (!RELEASE_STATUSES.includes(r.release_status)) err('release_status', `release_status must be one of ${RELEASE_STATUSES.join('|')}`);
    if (!PRIORITIES.includes(r.priority)) err('priority', `priority must be one of ${PRIORITIES.join('|')}`);
    if (!nonEmpty(r.owner)) err('owner', 'owner is required');
    if (r.figma?.evidence !== undefined && !FIGMA_EVIDENCE.includes(r.figma.evidence)) err('figma.evidence', `figma.evidence must be one of ${FIGMA_EVIDENCE.join('|')}`);
    if (r.figma?.annotation_status !== undefined && !ANNOTATION_STATUS.includes(r.figma.annotation_status)) err('figma.annotation_status', `figma.annotation_status must be one of ${ANNOTATION_STATUS.join('|')}`);
    // The annotated frame is a separate node; recording the clean frame's ID here would send the docs author to the wrong frame.
    if (r.figma?.annotated_node_id !== undefined && (!nonEmpty(r.figma.annotated_node_id) || r.figma.annotated_node_id === r.figma.node_id)) err('figma.annotated_node_id', 'figma.annotated_node_id must be the annotated frame\'s node ID, not empty and not the clean frame\'s node_id');
    if (r.source?.type !== undefined && !SOURCE_TYPES.includes(r.source.type)) err('source.type', `source.type must be one of ${SOURCE_TYPES.join('|')}`);

    // Secrets, tokens, customer data, and unresolved placeholders anywhere in the record.
    for (const [path, value] of strings(r, '')) {
      for (const [re, what] of SECRET_PATTERNS) if (re.test(value)) err(path, `looks like ${what}; inventory metadata must not hold secrets or customer data`);
      if (/\{\{|\}\}/.test(value) && !path.startsWith('capture.actions') && !path.startsWith('capture.checks')) err(path, 'contains "{{" or "}}" (an unfilled placeholder)');
    }

    // Consistency between statuses.
    if (r.status === 'retired') {
      if (r.release_status !== 'retire') err('release_status', 'a retired record must have release_status "retire"');
      if (!nonEmpty(r.retired_reason)) err('retired_reason', 'retired_reason is required');
      if (!ISO_RE.test(r.retired_at || '')) err('retired_at', 'retired_at must be an ISO date or timestamp');
    }
    if (r.release_status === 'unchanged' && !['inserted', 'verified'].includes(r.status)) err('release_status', `"unchanged" means the published image is still right, so status must be "inserted" or "verified", not "${r.status}"`);
    if (r.release_status === 'new' && r.status === 'verified' && r.history?.length) err('release_status', 'a record with history is a refresh, not new');

    if (STATUSES.includes(r.status)) {
      for (const g of gateErrors(r, r.status, { allIds: ids.filter(x => x !== r.screenshot_id) })) err(g.field, g.message);
    }
    // Text that is present at any stage must be clean, so a bad alt text is caught before handoff.
    for (const [kind, key] of [['caption', 'caption'], ['alt_text', 'alt_text']]) {
      const text = r.content?.[key];
      if (text === undefined) continue;
      const t = checkText(kind, text, r.screenshot_id, ids.filter(x => x !== r.screenshot_id));
      if (RANK[r.status] < RANK.handed_off) for (const m of t.errors) err(`content.${key}`, m);
      for (const m of t.warnings) push(warnings, id, `content.${key}`, m);
    }

    for (const [h, hist] of (r.history || []).entries()) {
      if (!hist || !RELEASE_RE.test(hist.release || '') || !hist.asset?.path || !SHA_RE.test(hist.asset?.sha256 || '')) err(`history[${h}]`, 'a history entry needs release, asset.path, and asset.sha256');
    }
    if (isActive(r) && r.source) {
      const key = anchorKey(r);
      if (docKey(r) && r.source.docs_heading && r.publication?.docs_image_slot) {
        if (anchors.has(key)) err('publication.docs_image_slot', `duplicate active documentation anchor (also used by ${anchors.get(key)})`);
        else anchors.set(key, id);
      }
    }
  });

  if (previous && Array.isArray(previous.records)) {
    const before = new Map(previous.records.map(r => [r.screenshot_id, r]));
    const after = new Map(doc.records.map(r => [r.screenshot_id, r]));
    for (const [id, old] of before) {
      const now = after.get(id);
      if (!now) { push(errors, id, '', 'record was removed; retire it instead so its history is kept'); continue; }
      const t = transitionError(old.status, now.status);
      if (t) push(errors, id, 'status', t);
      if (old.status === 'retired' && JSON.stringify(old) !== JSON.stringify(now)) push(errors, id, '', 'a retired record must not change');
    }
  }
  return { errors, warnings };
}

export function formatIssues(issues, label = 'ERROR') {
  return issues.map(i => `  ${label}  ${i.id}${i.field ? `  ${i.field}` : ''}: ${i.message}`).join('\n');
}

/** What is still missing for a record to reach its next status. */
export function prerequisites(r, ctx = {}) {
  const next = nextStatus(r.status);
  if (!next) return { next: null, missing: [] };
  // Before capture, only the inputs the harness needs matter; asset fields are filled in by record-capture.
  if (r.status === 'approved') return { next, missing: gateErrors(r, next, ctx).filter(g => g.field.startsWith('capture.')) };
  return { next, missing: gateErrors(r, next, ctx) };
}

// ---------------------------------------------------------------- queries

export function listRecords(doc, f = {}) {
  return doc.records.filter(r =>
    (!f.status || r.status === f.status) &&
    (!f.release || r.capture?.release === f.release) &&
    (!f.owner || r.owner === f.owner) &&
    (!f.workstream || r.capture?.workstream === f.workstream) &&
    (!f.releaseStatus || r.release_status === f.releaseStatus) &&
    (!f.id || r.screenshot_id === f.id));
}

export const targetKey = r => `${r.capture?.project || '?'} | ${r.capture?.workstream || '?'} | ${r.capture?.page || '?'}`;

const FILTERS_CAPTURE = ['project', 'workstream', 'page', 'release', 'state'];

/**
 * Capture brief for approved records. Only approved records that need a new image (release_status
 * "new" or "refresh") run. Incomplete records are returned in `blocked`; the caller decides to fail.
 * Records for other project/workstream/page targets are returned in `otherTargets` (one run per target).
 */
export function generateBrief(doc, { file, release = null, ids = null, target = null, commit = null } = {}) {
  const candidates = doc.records.filter(r => r.status === 'approved' && ['new', 'refresh'].includes(r.release_status) &&
    (!release || r.capture?.release === release) && (!ids || ids.includes(r.screenshot_id)));
  const allIds = doc.records.map(r => r.screenshot_id);
  const blocked = [];
  const ready = [];
  for (const r of candidates) {
    const missing = [];
    for (const k of FILTERS_CAPTURE) if (!nonEmpty(r.capture?.[k])) missing.push(`capture.${k}`);
    if (!Array.isArray(r.capture?.actions)) missing.push('capture.actions');
    if (!Array.isArray(r.capture?.checks) || !r.capture.checks.length) missing.push('capture.checks');
    if (r.capture?.release && !RELEASE_RE.test(r.capture.release)) missing.push('capture.release (invalid characters)');
    for (const g of gateErrors(r, 'approved', { allIds })) missing.push(g.field);
    if (missing.length) blocked.push({ id: r.screenshot_id, missing: [...new Set(missing)] });
    else ready.push(r);
  }
  const groups = new Map();
  for (const r of ready) {
    if (!groups.has(targetKey(r))) groups.set(targetKey(r), []);
    groups.get(targetKey(r)).push(r);
  }
  let chosen = null, chosenKey = null;
  if (target) {
    chosenKey = [...groups.keys()].find(k => k === target);
    chosen = chosenKey ? groups.get(chosenKey) : [];
  } else if (groups.size === 1) {
    [chosenKey, chosen] = [...groups.entries()][0];
  }
  const otherTargets = [...groups.entries()].filter(([k]) => k !== chosenKey).map(([k, rs]) => ({ target: k, ids: rs.map(r => r.screenshot_id) }));
  const shots = (chosen || []).map(r => {
    const setup = [
      { editorReady: { projectName: '{{projectName}}', pageLabel: '{{pageLabel}}' } },
      { selectWorkstream: { name: '{{workstream}}' } },
    ];
    const actions = [...setup, ...r.capture.actions];
    // Close the workstream menu after setup, unless the record opens it on purpose or already closes it.
    const name = a => (typeof a === 'string' ? a : Object.keys(a || {})[0]);
    if (!r.capture.actions.some(a => ['workstreamMenuClosed', 'openWorkstreamMenu'].includes(name(a)))) actions.push('workstreamMenuClosed');
    return {
      slug: r.screenshot_id,
      screenshotId: r.screenshot_id,
      release: r.capture.release,
      label: shortTitle(r),
      ...(r.content?.caption ? { caption: r.content.caption } : {}),
      ...(r.content?.alt_text ? { altText: r.content.alt_text } : {}),
      url: '{{editorUrl}}',
      delay: 1500,
      section: 'inventory',
      actions,
      expectAfter: r.capture.checks,
    };
  });
  const brief = {
    topic: '{{topic}}',
    site: '{{baseUrl}}',
    description: `Generated from the screenshot inventory by scripts/inventory.mjs brief. Do not edit; change the inventory records instead.${release ? ` Release ${release}.` : ''}`,
    dpr: 2,
    presets: ['p1-editor'],
    inventory: { file, commit, target: chosenKey },
    shots,
  };
  return { brief, ready: ready.map(r => r.screenshot_id), blocked, groups: [...groups.keys()], chosenKey, otherTargets, candidates: candidates.map(r => r.screenshot_id) };
}

/** Everything that links one screenshot to its Figma frame, local asset, docs slot, and publication. */
export function mappingFor(r, { inventory = null } = {}) {
  const f = r.figma || {}, a = r.asset || {}, s = r.source || {}, p = r.publication || {}, ct = r.content || {};
  const health = publicationHealth(r);
  const evidence = f.evidence || 'none';
  const unverified = [];
  const miss = (cond, what) => { if (cond) unverified.push(what); };
  miss(evidence === 'none' || evidence === 'planned', `figma: evidence is "${evidence}" (nothing recorded as uploaded)`);
  miss(evidence !== 'not_used' && !f.node_id, 'figma.node_id');
  miss(evidence !== 'not_used' && !f.annotated_node_id, 'figma.annotated_node_id');
  miss(evidence !== 'not_used' && !f.version_name, 'figma.version_name');
  miss(!a.sha256, 'asset.sha256');
  miss(!s.docs_document_id, 'source.docs_document_id (only a URL is recorded)');
  miss(!ct.caption, 'content.caption');
  miss(!ct.alt_text, 'content.alt_text');
  miss(!p.published_url, 'publication.published_url');
  miss(!p.published_sha256, 'publication.published_sha256');
  miss(!p.verified_at, 'publication.verified_at');
  miss(health.state === 'stale', `publication is stale: ${health.reasons.join('; ')}`);
  return {
    screenshot_id: r.screenshot_id,
    title: shortTitle(r),
    status: r.status,
    release_status: r.release_status,
    inventory,
    source: { type: s.type || null, request_url: s.request_url || null, reason: s.reason || null },
    figma: {
      evidence_state: evidence === 'none' ? 'unverified' : evidence,
      file_url: f.file_url || null, page_name: f.page_name || null,
      clean_frame_name: frameName(r, 'clean'), annotated_frame_name: frameName(r, 'annotated'),
      node_id: f.node_id || null, annotated_node_id: f.annotated_node_id || null, version_name: f.version_name || null, branch_url: f.branch_url || null,
      dev_resource_urls: f.dev_resource_urls || [], manifest_commit: f.manifest_commit || null,
      annotation_status: f.annotation_status || 'none',
    },
    asset: { path: a.path || assetPath(r.screenshot_id, r.capture?.release || '<release>'), sha256: a.sha256 || null, width: a.width ?? null, height: a.height ?? null, captured_at: a.captured_at || null, source: a.source || null },
    docs: { ...composeAnchor(r), required_reviewer: r.reviewer || null },
    content: { caption: ct.caption ?? null, alt_text: ct.alt_text ?? null, alt_text_fingerprint: ct.alt_text ? altFingerprint(ct.alt_text) : null },
    publication: { state: health.state, reasons: health.reasons, published_url: p.published_url || null, published_sha256: p.published_sha256 || null, verified_release: p.verified_release || null, verified_at: p.verified_at || null },
    unverified,
  };
}

export function lookup(doc, q) {
  const act = doc.records;
  if (q.id) {
    const r = act.find(x => x.screenshot_id === q.id);
    if (!r) return { error: `no record ${q.id}` };
    return { records: [mappingFor(r)] };
  }
  if (q.doc) {
    const needle = q.doc.trim().toLowerCase();
    let rs = act.filter(r => (r.source?.docs_document_id || '').toLowerCase() === needle || (r.source?.docs_url || '').toLowerCase().replace(/\/+$/, '') === needle.replace(/\/+$/, ''));
    if (q.heading) rs = rs.filter(r => (r.source?.docs_heading || '').toLowerCase() === q.heading.trim().toLowerCase());
    return { records: rs.map(r => mappingFor(r)) };
  }
  if (q.refresh) return { records: act.filter(r => ['new', 'refresh'].includes(r.release_status) && r.capture?.release === q.refresh && r.status !== 'retired').map(r => mappingFor(r)) };
  if (q.unverified) return { records: act.filter(r => isActive(r) && publicationHealth(r).state !== 'verified').map(r => mappingFor(r)) };
  if (q.stale) return { records: act.filter(r => ['stale', 'unverifiable'].includes(publicationHealth(r).state)).map(r => mappingFor(r)) };
  return { error: 'give one of: --id, --doc [--heading], --refresh <release>, --unverified, --stale' };
}

// ---------------------------------------------------------------- new versions

const strip = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** "0.20.0", "v0.20.0", "0.18.1-canary-2026" -> { nums: [0, 20, 0], pre: null | "canary-2026" }. Anything else -> null. */
export function parseVersion(v) {
  const m = String(v ?? '').trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || null } : null;
}

/** -1, 0, or 1; null when either side isn't a semantic version. A prerelease sorts before its release. */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * Which screenshots does a new product version put in question? A published screenshot (inserted or
 * verified) whose capture.release is an older version is a candidate: the UI may have changed. Whether it
 * did is decided by capturing again and comparing pixels (compare-runs), not here. Records whose release
 * isn't a version can't be compared and are listed apart; nothing is guessed.
 */
export function releaseCheck(doc, version) {
  const target = parseVersion(version);
  if (!target) return { error: `"${version}" is not a version like 1.2.3` };
  const out = { version, candidates: [], current: [], behind: [], unversioned: [] };
  for (const r of doc.records) {
    if (r.status === 'retired' || r.release_status === 'retire') continue;
    const rel = r.capture?.release;
    const cmp = rel ? compareVersions(rel, version) : null;
    const published = ['inserted', 'verified'].includes(r.status);
    if (rel === version || cmp === 0) { out.current.push(r.screenshot_id); continue; }
    if (cmp === null) { if (published) out.unversioned.push({ id: r.screenshot_id, release: rel || null }); continue; }
    if (cmp > 0) continue; // captured against a newer version than this check
    if (published) out.candidates.push({ id: r.screenshot_id, status: r.status, captured_for: rel });
    else out.behind.push({ id: r.screenshot_id, status: r.status, targets: rel });
  }
  return out;
}

/**
 * Reopen a published record for a new release: what was published goes into history, per-release evidence
 * is cleared, and the docs slot stays. The caller sets the status and validates.
 */
export function reopenForRelease(r, release, releaseStatus = 'refresh') {
  if (r.asset?.path && r.asset?.sha256) {
    (r.history || (r.history = [])).push(strip({ release: r.capture.release, asset: r.asset, figma: strip({ file_url: r.figma?.file_url, node_id: r.figma?.node_id, annotated_node_id: r.figma?.annotated_node_id, version_name: r.figma?.version_name }), published_url: r.publication?.published_url, published_sha256: r.publication?.published_sha256, verified_at: r.publication?.verified_at }));
  }
  r.capture.release = release;
  r.release_status = releaseStatus;
  delete r.asset; delete r.figma;
  r.publication = strip({ docs_image_slot: r.publication?.docs_image_slot });
}

/**
 * Release view. Only records whose release_status asks for work are "affected". An absent record is
 * never turned into a refresh: shots in a run that no record covers are reported as inventory gaps.
 * `runRows` (from compare-runs) and `newReport` (the new capture-report.json) are optional.
 */
export function releaseReport(doc, release, { runRows = null, newReport = null } = {}) {
  const rowsBySlug = new Map((runRows || []).map(r => [r.slug, r]));
  const capturedIds = new Set((newReport?.results || []).filter(r => r.ok && r.side === 'next').map(r => r.slug));
  const affected = doc.records.filter(r => ['new', 'refresh', 'retire'].includes(r.release_status) && r.capture?.release === release)
    .map(r => {
      const m = mappingFor(r);
      const cmp = rowsBySlug.get(r.screenshot_id);
      return {
        screenshot_id: r.screenshot_id,
        action: r.release_status,
        reason: r.source?.reason || null,
        capture_target: r.capture ? { project: r.capture.project, workstream: r.capture.workstream, page: r.capture.page, state: r.capture.state } : null,
        docs_location: { document: r.source?.docs_document_id || r.source?.docs_url || null, heading: r.source?.docs_heading || null, image_slot: r.publication?.docs_image_slot || null },
        figma_evidence: m.figma.evidence_state,
        current_asset: r.history?.length ? r.history[r.history.length - 1].asset.path : (r.release_status === 'refresh' ? r.asset?.path || null : null),
        replacement_asset_path: r.release_status === 'retire' ? null : assetPath(r.screenshot_id, release),
        handoff_state: r.status,
        verification_state: m.publication.state,
        pixels: cmp ? cmp.status : null,
        captured_in_run: newReport ? capturedIds.has(r.screenshot_id) : null,
      };
    });
  const unchanged = doc.records.filter(r => r.release_status === 'unchanged').map(r => r.screenshot_id);
  const review = (runRows || []).filter(c => unchanged.includes(c.slug) && ['changed', 'resized'].includes(c.status)).map(c => ({ screenshot_id: c.slug, pixels: c.status, note: 'marked unchanged but its pixels changed; decide whether it needs a refresh record' }));
  const known = new Set(doc.records.map(r => r.screenshot_id));
  const gaps = newReport ? [...new Set(newReport.results.filter(r => r.side === 'next').map(r => r.slug))].filter(s => !known.has(s)).map(s => ({ shot: s, gap: 'captured in the run but no inventory record covers it' })) : [];
  const notCaptured = newReport ? affected.filter(a => a.action !== 'retire' && a.captured_in_run === false).map(a => a.screenshot_id) : [];
  return { release, affected, unchanged, review, gaps, notCaptured };
}

export function unverifiedFields(r) { return mappingFor(r).unverified; }

/**
 * Traceability audit: for every image the inventory knows about, check the whole chain
 * screenshot_id -> release -> local asset and checksum -> Figma page and frames -> docs article,
 * heading, and slot -> published URL -> verification state. Read-only.
 *
 * `files` (optional) lets the caller supply what it found on disk, so this function stays pure:
 *   files.assets: { [assetPath]: { exists, sha256, width, height } }  (from --assets-dir)
 *   files.runShots: [{ slug, screenshotId }]                           (from --run's capture report)
 * Returns { assets: [...], notCaptured: [...], gaps: [...], ok }.
 */
export function traceInventory(doc, files = {}) {
  const allIds = doc.records.map(r => r.screenshot_id);
  const byId = new Map(doc.records.map(r => [r.screenshot_id, r]));
  const assets = [], notCaptured = [], gaps = [];
  for (const r of doc.records) {
    if (r.status === 'retired' || r.release_status === 'retire') continue;
    if (!r.asset) { notCaptured.push({ id: r.screenshot_id, status: r.status }); continue; }
    const a = r.asset, f = r.figma || {}, s = r.source || {}, p = r.publication || {}, c = r.content || {};
    const problems = [];
    const need = (ok, what) => { if (!ok) problems.push(what); };
    const release = r.capture?.release;
    need(nonEmpty(release) && RELEASE_RE.test(release), 'release is missing or invalid');
    need(a.path === assetPath(r.screenshot_id, release), `asset path is not ${assetPath(r.screenshot_id, release || '<release>')}`);
    need(SHA_RE.test(a.sha256 || ''), 'checksum is missing');
    need(Number.isInteger(a.width) && a.width > 0 && Number.isInteger(a.height) && a.height > 0, 'dimensions are missing');
    need(ISO_RE.test(a.captured_at || ''), 'capture time is missing');
    for (const [kind, key] of [['caption', 'caption'], ['alt_text', 'alt_text']]) {
      const t = checkText(kind, c[key], r.screenshot_id, allIds.filter(x => x !== r.screenshot_id));
      for (const e of t.errors) problems.push(`${kind}: ${e}`);
    }
    need(nonEmpty(r.reviewer), 'reviewer is missing');
    const ev = f.evidence || 'none';
    if (ev === 'not_used') problems.push(`no Figma reference (Figma marked not used: ${f.not_used_reason || 'no reason given'})`);
    else {
      need(ev === 'uploaded' || ev === 'verified', `no Figma reference (evidence is "${ev}")`);
      need(nonEmpty(f.file_url), 'Figma file URL is missing');
      need(nonEmpty(f.page_name), 'Figma run page is missing');
      need(nonEmpty(f.node_id), 'Figma node ID is missing');
      need(nonEmpty(f.annotated_node_id), 'annotated frame node ID is missing (record-figma --annotated-node-id)');
      need(f.frame_name === frameName(r, 'clean'), `clean frame must be "${frameName(r, 'clean')}"`);
      need(f.annotated_frame_name === frameName(r, 'annotated'), `annotated frame must be "${frameName(r, 'annotated')}" (the docs embed the annotated frame)`);
      need(f.annotation_status === 'complete', `annotation is not complete (annotation_status is "${f.annotation_status || 'none'}"); the docs embed the annotated frame`);
    }
    need(nonEmpty(s.docs_document_id) || nonEmpty(s.docs_url), 'docs article is missing');
    need(nonEmpty(s.docs_heading), 'docs heading is missing');
    need(nonEmpty(p.docs_image_slot), 'docs image slot is missing');
    const health = publicationHealth(r);
    need(!['stale', 'unverifiable'].includes(health.state), `publication is ${health.state}: ${health.reasons.join('; ')}`);
    const disk = files.assets ? files.assets[a.path] : undefined;
    if (files.assets) {
      if (!disk || !disk.exists) problems.push(`asset file not found in the assets folder (${a.path})`);
      else {
        need(disk.sha256 === a.sha256, 'asset file checksum differs from the inventory');
        need(disk.width === a.width && disk.height === a.height, 'asset file dimensions differ from the inventory');
      }
    }
    const history = (r.history || []).map(h => {
      const hp = [];
      if (!RELEASE_RE.test(h.release || '')) hp.push('release is invalid');
      if (h.asset?.path !== assetPath(r.screenshot_id, h.release)) hp.push(`path is not ${assetPath(r.screenshot_id, h.release || '<release>')}`);
      if (!SHA_RE.test(h.asset?.sha256 || '')) hp.push('checksum is missing');
      if (hp.length) problems.push(`history ${h.release}: ${hp.join('; ')}`);
      return { release: h.release || null, path: h.asset?.path || null, sha256: h.asset?.sha256 || null, published_url: h.published_url || null };
    });
    assets.push({
      screenshot_id: r.screenshot_id,
      release: release || null,
      asset: { path: a.path || null, sha256: a.sha256 || null, width: a.width ?? null, height: a.height ?? null, captured_at: a.captured_at || null, on_disk: files.assets ? Boolean(disk?.exists) : null },
      figma: { evidence: ev, file_url: f.file_url || null, run_page: f.page_name || null, clean_frame: f.frame_name || null, annotated_frame: f.annotated_frame_name || null, node_id: f.node_id || null, annotated_node_id: f.annotated_node_id || null },
      docs: { article: s.docs_document_id || s.docs_url || null, heading: s.docs_heading || null, image_slot: p.docs_image_slot || null, embeds: 'annotated frame' },
      text: { caption: c.caption ?? null, alt_text: c.alt_text ?? null, reviewer: r.reviewer || null },
      published_url: p.published_url || null,
      published_sha256: p.published_sha256 || null,
      verification: health.state,
      history,
      problems,
    });
  }
  for (const shot of files.runShots || []) {
    if (!shot.screenshotId) gaps.push({ shot: shot.slug, gap: 'captured image has no screenshot ID (not an inventory record)' });
    else if (!byId.has(shot.screenshotId)) gaps.push({ shot: shot.slug, gap: `no inventory record for ${shot.screenshotId}` });
  }
  return { assets, notCaptured, gaps, ok: gaps.length === 0 && assets.every(x => x.problems.length === 0) };
}

export function renderTrace(t) {
  const L = ['# Image traceability report', ''];
  L.push(`Images checked: ${t.assets.length}. With problems: ${t.assets.filter(a => a.problems.length).length}. Inventory gaps: ${t.gaps.length}. Records not captured yet: ${t.notCaptured.length}.`, '');
  for (const a of t.assets) {
    L.push(`## ${a.screenshot_id}${a.problems.length ? ' (FAILS)' : ''}`, '', '```text',
      a.screenshot_id,
      `  → release ${a.release ?? '(missing)'}`,
      `  → ${a.asset.path ?? '(no path)'}  sha256 ${a.asset.sha256 ? a.asset.sha256.slice(0, 16) + '…' : '(missing)'}  ${a.asset.width ?? '?'}x${a.asset.height ?? '?'}${a.asset.on_disk === null ? '' : a.asset.on_disk ? '  (file checked)' : '  (file missing)'}`,
      `  → Figma ${a.figma.evidence}: page ${a.figma.run_page ?? '(none)'} / clean ${a.figma.clean_frame ?? '(none)'} node ${a.figma.node_id ?? '(none)'} / annotated node ${a.figma.annotated_node_id ?? '(none)'}`,
      `  → docs ${a.docs.article ?? '(none)'} / "${a.docs.heading ?? '(none)'}" / ${a.docs.image_slot ?? '(none)'} (annotated frame)`,
      `  → published ${a.published_url ?? '(not known)'}${a.published_sha256 ? `  sha256 ${a.published_sha256.slice(0, 16)}…` : ''}`,
      `  → verification ${a.verification}`, '```', '');
    if (a.history.length) L.push(`Earlier versions: ${a.history.map(h => `${h.release} (${h.path})`).join(', ')}`, '');
    if (a.problems.length) { L.push('Problems:', ...a.problems.map(x => `- ${x}`), ''); }
  }
  if (t.gaps.length) L.push('## Inventory gaps', '', ...t.gaps.map(g => `- ${g.shot}: ${g.gap}`), '');
  if (t.notCaptured.length) L.push('## Not captured yet (no image to trace)', '', ...t.notCaptured.map(n => `- ${n.id} (${n.status})`), '');
  return L.join('\n');
}

export function renderDocsHandoff(doc, { release = null, ids = null, inventory = null } = {}) {
  const rs = doc.records.filter(r => r.status !== 'retired' && r.release_status !== 'unchanged' && (!release || r.capture?.release === release) && (!ids || ids.includes(r.screenshot_id)));
  const maps = rs.map(r => mappingFor(r, { inventory }));
  const lines = [`# Docs handoff from the screenshot inventory${release ? `: ${release}` : ''}`, ''];
  if (inventory) lines.push(`Inventory: \`${inventory.file}\` at commit ${inventory.commit ? `\`${inventory.commit.slice(0, 9)}\`${inventory.dirty ? ' (uncommitted changes)' : ''}` : '(not in git: unverified)'}.`, '');
  lines.push('Export the annotated frame and record it with `scripts/inventory.mjs record-asset`. The clean frame stays in Figma as the unannotated capture. The docs author inserts each image at the slot below, publishes it the way that document is normally published, then records the published URL and verifies it (`scripts/inventory.mjs record-publication`). Nothing here uploads to Google Docs or publishes anything.', '');
  if (!maps.length) lines.push('No records need handoff for this selection.');
  for (const m of maps) {
    lines.push(`## ${m.screenshot_id}: ${m.title}`, '',
      `- Status: ${m.status} (${m.release_status})`,
      `- Source request: ${m.source.type || '(none)'}${m.source.request_url ? ` ${m.source.request_url}` : ''}${m.source.reason ? `. ${m.source.reason}` : ''}`,
      `- Target article: ${m.docs.document_id || m.docs.document_url || '(not recorded)'}`,
      `- Heading: ${m.docs.heading || '(not recorded)'}`,
      `- Image slot: ${m.docs.image_slot || '(not recorded)'}`,
      `- Manual anchor: document + heading + slot + caption + alt fingerprint \`${m.docs.alt_text_fingerprint || '(no alt text)'}\``,
      `- Asset: \`${m.asset.path}\`${m.asset.sha256 ? ` sha256 \`${m.asset.sha256}\`, ${m.asset.width}x${m.asset.height}` : ' (no checksum recorded)'}`,
      `- Caption: ${m.content.caption ?? '(missing)'}`,
      `- Alt text: ${m.content.alt_text ?? '(missing)'}`,
      `- Figma (${m.figma.evidence_state}): export the annotated frame \`${m.figma.annotated_frame_name}\` (annotation ${m.figma.annotation_status})${m.figma.file_url ? `, file ${m.figma.file_url}` : ''}, node ${m.figma.annotated_node_id || '(not recorded)'}${m.figma.version_name ? `, version "${m.figma.version_name}"` : ''}${m.figma.branch_url ? `, branch ${m.figma.branch_url}` : ''}. The clean frame \`${m.figma.clean_frame_name}\`${m.figma.node_id ? ` (node ${m.figma.node_id})` : ''} is the unannotated capture; don't embed it.`,
      `- Required reviewer: ${m.docs.required_reviewer || '(not recorded)'}`,
      `- Publication: ${m.publication.state}${m.publication.published_url ? ` ${m.publication.published_url}` : ''}${m.publication.reasons.length ? ` (${m.publication.reasons.join('; ')})` : ''}`,
      `- Unverified: ${m.unverified.length ? m.unverified.join('; ') : 'none'}`, '');
  }
  return { markdown: lines.join('\n'), records: maps };
}
