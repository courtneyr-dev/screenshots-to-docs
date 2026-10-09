/**
 * Where release-check learns the latest shipped version of the product whose screens you document.
 *
 *   npm:<package>          the npm registry's "latest" dist-tag (a JavaScript SDK or app)
 *   github:<owner>/<repo>  the repository's latest GitHub release (drafts and prereleases are skipped by GitHub)
 *   wordpress              WordPress core, from api.wordpress.org
 *   wporg-plugin:<slug>    a plugin in the WordPress.org directory
 *   drupal                 Drupal core, the newest stable release on Drupal.org
 *   drupal:<project>       a Drupal.org project (module or theme), its newest stable release
 *   page:<url>             a version printed on a public page; --pattern is a regular expression whose
 *                          first group is the version, for example "Version (\d+\.\d+\.\d+)"
 *
 * The parsers below are pure so tests can feed them saved responses; latestVersion() does the one GET.
 */

const STABLE = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/;

export function parseSource(source) {
  if (typeof source !== 'string' || !source) throw new Error('a release source is empty');
  if (source === 'wordpress') return { kind: source };
  if (source === 'drupal') return { kind: 'drupal', project: 'drupal' };
  const i = source.indexOf(':');
  const kind = i > 0 ? source.slice(0, i) : '';
  const rest = i > 0 ? source.slice(i + 1) : '';
  if (kind === 'npm' && /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(rest)) return { kind, name: rest };
  if (kind === 'github' && /^[\w.-]+\/[\w.-]+$/.test(rest)) return { kind, repo: rest };
  if (kind === 'wporg-plugin' && /^[a-z0-9][a-z0-9-]*$/.test(rest)) return { kind, slug: rest };
  if (kind === 'drupal' && /^[a-z][a-z0-9_]*$/.test(rest)) return { kind, project: rest };
  if (kind === 'page') {
    let u;
    try { u = new URL(rest); } catch { throw new Error(`page source needs a URL: ${source}`); }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error(`page source must be an http(s) URL without credentials: ${source}`);
    return { kind, url: u.href };
  }
  throw new Error(`unknown release source "${source}". Use npm:<package>, github:<owner>/<repo>, wordpress, wporg-plugin:<slug>, drupal, drupal:<project>, or page:<url>`);
}

export function sourceUrl(src) {
  switch (src.kind) {
    case 'npm': return `https://registry.npmjs.org/${src.name.replace('/', '%2F')}/latest`;
    case 'github': return `https://api.github.com/repos/${src.repo}/releases/latest`;
    case 'wordpress': return 'https://api.wordpress.org/core/version-check/1.7/';
    case 'wporg-plugin': return `https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request%5Bslug%5D=${src.slug}&request%5Bfields%5D%5Bsections%5D=0`;
    case 'drupal': return `https://updates.drupal.org/release-history/${src.project}/current`;
    case 'page': return src.url;
  }
  throw new Error(`no URL for source kind ${src.kind}`);
}

const clean = v => String(v).trim().replace(/^v/, '');

// body is the response text. Returns the version string, or throws with what was wrong.
export function versionFrom(src, body, { pattern } = {}) {
  if (src.kind === 'page') {
    if (!pattern) throw new Error('a page source needs --pattern, a regular expression whose first group is the version');
    const m = new RegExp(pattern).exec(body);
    if (!m?.[1]) throw new Error(`the pattern ${pattern} found no version on ${src.url}`);
    return clean(m[1]);
  }
  if (src.kind === 'drupal') {
    // Drupal.org's update feed: one <release> per release. Stable means a plain x.y.z version.
    const stable = [...body.matchAll(/<release>[\s\S]*?<version>([^<]+)<\/version>/g)].map(m => m[1]).filter(x => STABLE.test(x));
    if (!stable.length) throw new Error(`no stable release of ${src.project} on Drupal.org`);
    stable.sort((a, b) => {
      const [x, y] = [a, b].map(s => STABLE.exec(s).slice(1).map(n => Number(n || 0)));
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    });
    return stable[0];
  }
  let j;
  try { j = JSON.parse(body); } catch { throw new Error(`the ${src.kind} source did not return JSON`); }
  let v = null;
  if (src.kind === 'npm') v = j.version;
  if (src.kind === 'github') v = j.tag_name;
  if (src.kind === 'wordpress') v = (j.offers || []).find(o => o.response === 'upgrade' || o.response === 'latest')?.current || j.offers?.[0]?.current;
  if (src.kind === 'wporg-plugin') { if (j.error) throw new Error(`${src.slug}: ${j.error}`); v = j.version; }
  if (!v) throw new Error(`no version found in the ${src.kind} response`);
  // A monorepo's latest GitHub release can be any of its packages (@scope/name@1.2.3). Use npm:<package> for those.
  if (!/^v?\d+\.\d+/.test(String(v).trim())) throw new Error(`the latest ${src.kind} release is "${v}", which isn't a version${src.kind === 'github' ? '. For a repository that releases several packages, use npm:<package>' : ''}`);
  return clean(v);
}

export async function latestVersion(source, { pattern, fetchImpl = fetch } = {}) {
  const src = parseSource(source);
  const url = sourceUrl(src);
  const res = await fetchImpl(url, { headers: { accept: src.kind === 'page' ? 'text/html' : src.kind === 'drupal' ? 'application/xml' : 'application/json', 'user-agent': 'screenshots-to-docs release-check' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  return versionFrom(src, await res.text(), { pattern });
}
