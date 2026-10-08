/**
 * p1-editor-screenshots / gdocs-swap (Google Apps Script, standalone project)
 *
 * Replaces release screenshots in Google Docs from a manifest pinned to a git commit
 * (scripts/gdocs-manifest.mjs), and writes each image's alt text. See references/release-swap.md.
 *
 * Script properties (Project Settings > Script properties):
 *   GITHUB_TOKEN   fine-grained token, read-only Contents on the one repository (a property only, never a file)
 *   MANIFEST_REPO  owner/name
 *   MANIFEST_PATH  path of manifest.json in that repository
 *   MANIFEST_REF   the commit the manifest was built for (40 hex characters)
 * The three MANIFEST_* values can instead come from SWAP_CONFIG in Config.gs, which npm run setup writes.
 *
 * Run dryRunSwap() first: it fetches everything, checks every checksum, finds every image, and edits
 * nothing. runSwap() then makes the changes. Both log one JSON report.
 */

function dryRunSwap() { return logReport_(swap_(loadManifest_(), { dryRun: true })); }
function runSwap() { return logReport_(swap_(loadManifest_(), { dryRun: false })); }

var REPO_RE_ = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
var SHA_RE_ = /^[0-9a-f]{40}$/;

function props_() {
  var p = PropertiesService.getScriptProperties();
  // Config.gs (written by npm run setup) may define SWAP_CONFIG for the non-secret settings; a script property wins.
  var file = typeof SWAP_CONFIG === 'object' && SWAP_CONFIG ? SWAP_CONFIG : {};
  function need(k) {
    var v = p.getProperty(k) || (k === 'GITHUB_TOKEN' ? null : file[k]);
    if (!v) throw new Error('Set the script property ' + k + (k === 'GITHUB_TOKEN' ? ' (Project Settings > Script properties)' : ''));
    return v;
  }
  var c = { token: need('GITHUB_TOKEN'), repo: need('MANIFEST_REPO'), path: need('MANIFEST_PATH'), ref: need('MANIFEST_REF') };
  if (!REPO_RE_.test(c.repo)) throw new Error('MANIFEST_REPO must look like owner/name');
  if (!SHA_RE_.test(c.ref)) throw new Error('MANIFEST_REF must be a full 40-character commit SHA');
  return c;
}

/** One file from the configured private repository at a pinned commit, through the GitHub contents API. */
function githubFile_(cfg, repo, path, ref) {
  if (repo !== cfg.repo) throw new Error('refusing ' + repo + ': the token is only used for MANIFEST_REPO ' + cfg.repo);
  if (!SHA_RE_.test(ref)) throw new Error('refusing ref ' + ref + ': not a commit SHA');
  if (!path || path.split('/').indexOf('..') !== -1 || path.charAt(0) === '/') throw new Error('refusing path ' + path);
  var url = 'https://api.github.com/repos/' + repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + ref;
  var res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' },
    muteHttpExceptions: true, followRedirects: false,
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('GitHub answered HTTP ' + code + ' for ' + path + '@' + ref.slice(0, 7));
  return res.getBlob();
}

function loadManifest_() {
  var cfg = props_();
  var m = JSON.parse(githubFile_(cfg, cfg.repo, cfg.path, cfg.ref).getDataAsString());
  if (m.version !== 1 || !Array.isArray(m.entries)) throw new Error('not a version 1 swap manifest');
  m.cfg_ = cfg;
  return m;
}

function hex_(bytes) {
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

/** Same as altFingerprint in scripts/lib/inventory.mjs: NFKC, lowercase, collapsed spaces, sha256, 16 hex. */
function fingerprint_(text) {
  var norm = String(text == null ? '' : text).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, norm, Utilities.Charset.UTF_8)).slice(0, 16);
}

function matches_(img, entry) {
  var title = img.getAltTitle() || '', desc = img.getAltDescription() || '';
  if (entry.match.title && title === entry.match.title) return true;
  var fps = entry.match.fingerprints || [];
  return (desc && fps.indexOf(fingerprint_(desc)) !== -1) || (title && fps.indexOf(fingerprint_(title)) !== -1);
}

function swap_(manifest, opts) {
  var results = [], blobs = {}, docs = {};
  manifest.entries.forEach(function (e) { (docs[e.document_id] = docs[e.document_id] || []).push(e); });
  Object.keys(docs).forEach(function (docId) {
    var doc;
    try { doc = DocumentApp.openById(docId); } catch (err) {
      docs[docId].forEach(function (e) { results.push({ screenshot_id: e.screenshot_id, document_id: docId, status: 'error', detail: 'cannot open the document: ' + err.message }); });
      return;
    }
    var images = doc.getBody().getImages(), claimed = [];
    docs[docId].forEach(function (e) {
      var r = { screenshot_id: e.screenshot_id, document_id: docId, release: e.release };
      results.push(r);
      var key = e.image.path + '@' + e.image.ref, blob = blobs[key];
      try { if (!blob) blob = blobs[key] = githubFile_(manifest.cfg_, e.image.repo, e.image.path, e.image.ref); }
      catch (err) { r.status = 'error'; r.detail = err.message; return; }
      var got = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, blob.getBytes()));
      if (got !== e.image.sha256) { r.status = 'checksum-mismatch'; r.detail = 'expected ' + e.image.sha256.slice(0, 16) + ', got ' + got.slice(0, 16); return; }
      var found = images.filter(function (img) { return matches_(img, e); });
      if (found.length === 0) { r.status = 'not-found'; r.detail = 'no inline image whose alt text matches this record'; return; }
      if (found.length > 1 || claimed.indexOf(found[0]) !== -1) { r.status = 'ambiguous'; r.detail = found.length + ' images match; nothing changed for this entry'; return; }
      var old = found[0];
      claimed.push(old);
      r.old_alt = old.getAltDescription() || old.getAltTitle() || '';
      r.width = old.getWidth();
      if (opts.dryRun) { r.status = 'would-replace'; return; }
      var parent = old.getParent(), at = parent.getChildIndex(old);
      var fresh = parent.insertInlineImage(at, blob);
      var nw = e.image.width || fresh.getWidth(), nh = e.image.height || fresh.getHeight();
      fresh.setWidth(r.width).setHeight(Math.round(r.width * nh / nw));
      fresh.setAltTitle(e.alt.title).setAltDescription(e.alt.description);
      old.removeFromParent();
      r.status = 'replaced';
    });
    if (!opts.dryRun) doc.saveAndClose();
  });
  return { dryRun: !!opts.dryRun, repo: manifest.repo, ref: manifest.ref, results: results };
}

function logReport_(report) {
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
