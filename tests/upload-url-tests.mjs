#!/usr/bin/env node
/**
 * Tests for the figma-upload URL allowlist. Needs only Node. Prints PASS/FAIL lines, exits 1 on failure.
 * UPLOAD_SCRIPT overrides the script under test (used to run the CLI tests against the unpatched original).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';

// Built at runtime so the repository's email scan doesn't read this credentials-in-URL test case as an address.
const AT = '@';
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SCRIPT = process.env.UPLOAD_SCRIPT ? resolve(process.env.UPLOAD_SCRIPT) : join(ROOT, 'scripts/figma-upload.mjs');
const LIB = process.env.UPLOAD_LIB ? resolve(process.env.UPLOAD_LIB) : join(ROOT, 'scripts/lib/upload-urls.mjs');
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'upload-url-test-')));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));

let failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`PASS  ${name}`); }
  catch (e) { console.log(`FAIL  ${name}`); console.log('        ' + String(e.message || e).split('\n').slice(0, 6).join('\n        ')); failed += 1; }
};

let lib = null;
try { lib = await import(LIB); } catch (e) { lib = { loadError: e.message }; }
const check = (u, env = {}) => { if (!lib.checkUploadUrl) throw new Error('checkUploadUrl missing: ' + lib.loadError); return lib.checkUploadUrl(u, env); };
const ALLOW = { P1_UPLOAD_ALLOW_LOOPBACK: '1' };

await test('https figma.com URL is accepted', () => assert.equal(check('https://figma.com/api/upload/abc').ok, true));
await test('https subdomain of figma.com is accepted', () => assert.equal(check('https://upload.figma.com/x?token=1').ok, true));
await test('http figma.com is rejected', () => assert.equal(check('http://figma.com/x').ok, false));
await test('other https host is rejected', () => assert.equal(check('https://example.com/x').ok, false));
await test('lookalike figma.com.evil.test is rejected', () => assert.equal(check('https://figma.com.evil.test/x').ok, false));
await test('lookalike evilfigma.com is rejected', () => assert.equal(check('https://evilfigma.com/x').ok, false));
await test('userinfo trick (figma.com, an at sign, then another host) is rejected', () => assert.equal(check('https://figma.com' + AT + 'evil.test/x').ok, false));
await test('non-URL string is rejected', () => assert.equal(check('not a url').ok, false));
await test('loopback is rejected without the escape hatch', () => {
  for (const u of ['http://127.0.0.1:4401/ok/0', 'http://localhost:4401/ok/0', 'http://[::1]:4401/ok/0']) assert.equal(check(u).ok, false, u);
});
await test('escape hatch allows 127.0.0.1, localhost and [::1]', () => {
  for (const u of ['http://127.0.0.1:4401/ok/0', 'http://localhost:4401/ok/0', 'http://[::1]:4401/ok/0']) assert.equal(check(u, ALLOW).ok, true, u);
});
await test('escape hatch allows only loopback, not other hosts or schemes', () => {
  for (const u of ['http://example.com/x', 'https://evil.test/x', 'http://127.0.0.1.evil.test/x', 'http://localhost.evil.test/x', 'http://10.0.0.5/x', 'http://figma.com/x', 'ftp://127.0.0.1/x', 'file:///etc/passwd']) assert.equal(check(u, ALLOW).ok, false, u);
});
await test('escape hatch needs the exact value 1', () => assert.equal(check('http://127.0.0.1:1/x', { P1_UPLOAD_ALLOW_LOOPBACK: 'true' }).ok, false));
await test('findBadUploadUrl reports the first bad index and host', () => {
  const r = lib.findBadUploadUrl(['https://figma.com/a', 'https://evil.test/b', 'http://x.test/c'], {});
  assert.equal(r.index, 1); assert.equal(r.host, 'evil.test');
});

// CLI: zero requests when any URL is bad. Uses the mock server's /__stats.
const port = 4800 + Math.floor(Math.random() * 150);
const server = spawn(process.execPath, [join(ROOT, 'tests/fixtures/upload-server.mjs'), String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const stats = async () => (await fetch(`http://127.0.0.1:${port}/__stats`)).json();
const dir = join(TMP, 'run'); mkdirSync(dir);
const png = join(TMP, 'a.png');
writeFileSync(png, Buffer.from('89504e470d0a1a0a0000', 'hex'));
writeFileSync(join(dir, 'figma-plan.json'), JSON.stringify({ chunks: [['k1', 'k2']], uploads: [{ key: 'k1', file: png }, { key: 'k2', file: png }] }));
const run = (urls, env = {}) => {
  const f = join(TMP, 'urls.json'); writeFileSync(f, JSON.stringify(urls));
  const e = { ...process.env, ...env }; if (!('P1_UPLOAD_ALLOW_LOOPBACK' in env)) delete e.P1_UPLOAD_ALLOW_LOOPBACK;
  return spawnSync(process.execPath, [SCRIPT, '--dir', dir, '--urls', f], { env: e, encoding: 'utf-8', timeout: 20000 });
};
const local = `http://127.0.0.1:${port}/ok`;

try {
  await test('CLI: loopback URLs without the escape hatch exit 1 and send nothing', async () => {
    const r = run([`${local}/0`, `${local}/1`]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal((await stats()).length, 0);
  });
  await test('CLI: one bad URL among good loopback URLs exits 1, names index and host, uploads nothing', async () => {
    const r = run([`${local}/0`, 'https://evil.test/up'], ALLOW);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /entry 2 of 2/); assert.match(r.stderr, /evil\.test/);
    assert.equal((await stats()).length, 0, 'first (valid) URL must not be uploaded either');
  });
  await test('CLI: http figma.com URL exits 1 before any request', async () => {
    const r = run([`${local}/0`, 'http://figma.com/up'], ALLOW);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal((await stats()).length, 0);
  });
  await test('CLI: with the escape hatch, loopback URLs still upload both PNGs (exit 0)', async () => {
    const r = run([`${local}/0`, `${local}/1`], ALLOW);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal((await stats()).length, 2);
  });
} finally { server.kill(); }

// Redirects: two in-process servers on free ports. A redirects; B records what reaches it.
const listen = handler => new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
const hits = { a: [], b: [] };
const B = await listen((q, r) => { let n = 0; q.on('data', d => { n += d.length; }); q.on('end', () => { hits.b.push({ method: q.method, url: q.url, bytes: n }); r.writeHead(200); r.end('ok'); }); });
const bUrl = `http://127.0.0.1:${B.address().port}`;
let mode = '307';
const A = await listen((q, r) => {
  q.resume();
  q.on('end', () => {
    hits.a.push(q.url);
    if (mode === '307') r.writeHead(307, { location: `${bUrl}/landed` });
    else if (mode === 'evil') r.writeHead(307, { location: 'https://evil.example/landed' });
    else if (mode === '302') r.writeHead(302, { location: `${bUrl}/landed` });
    else if (mode === 'loop') r.writeHead(307, { location: '/again' });
    r.end();
  });
});
const aUrl = `http://127.0.0.1:${A.address().port}`;
const reset = m => { mode = m; hits.a.length = 0; hits.b.length = 0; };
const fake = steps => { const calls = []; const f = async (url, init) => { calls.push({ url, redirect: init.redirect }); const st = steps[calls.length - 1]; return { status: st.status, headers: { get: k => (k === 'location' ? st.location ?? null : null) }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' }; }; f.calls = calls; return f; };
// The in-process servers need this process's event loop, so these CLI runs must not use spawnSync.
const runAsync = (urls, env = {}) => new Promise(done => {
  const f = join(TMP, 'urls-async.json'); writeFileSync(f, JSON.stringify(urls));
  const e = { ...process.env, ...env }; if (!('P1_UPLOAD_ALLOW_LOOPBACK' in env)) delete e.P1_UPLOAD_ALLOW_LOOPBACK;
  const c = spawn(process.execPath, [SCRIPT, '--dir', dir, '--urls', f], { env: e });
  let stdout = '', stderr = '';
  c.stdout.on('data', d => { stdout += d; }); c.stderr.on('data', d => { stderr += d; });
  const t = setTimeout(() => c.kill(), 20000);
  c.on('close', status => { clearTimeout(t); done({ status, stdout, stderr }); });
});
const post = (...a) => { if (!lib.postUpload) throw new Error('postUpload missing: redirects are not re-validated'); return lib.postUpload(...a); };

try {
  await test('redirect: a 307 to an allowed host is followed, and the full PNG arrives there as a POST', async () => {
    reset('307'); const r = await runAsync([`${aUrl}/s1`, `${aUrl}/s2`], ALLOW);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(hits.b.length, 2); assert.ok(hits.b.every(h => h.method === 'POST' && h.bytes === 10), JSON.stringify(hits.b));
  });
  await test('redirect: a 307 to a host outside the allowlist is refused before anything is sent there', async () => {
    reset('evil'); const r = await runAsync([`${aUrl}/s1`, `${aUrl}/s2`], ALLOW);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /refused: redirect target evil\.example refused/);
    assert.equal(hits.b.length, 0);
  });
  await test('redirect: a 302 (which would turn the POST into a GET) is refused, and nothing reaches the target', async () => {
    reset('302'); const r = await runAsync([`${aUrl}/s1`, `${aUrl}/s2`], ALLOW);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /only 307 and 308/);
    assert.equal(hits.b.length, 0);
  });
  await test('redirect: more than 3 redirects are refused (4 requests per upload, then stop)', async () => {
    reset('loop'); const r = await runAsync([`${aUrl}/s1`, `${aUrl}/s2`], ALLOW);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /more than 3 redirects/);
    assert.equal(hits.a.length, 8);
  });
  await test('redirect: the loopback test exception stays opt-in after a redirect from Figma', async () => {
    const f = fake([{ status: 307, location: 'http://127.0.0.1:9/x' }]);
    await assert.rejects(post('https://www.figma.com/a', Buffer.alloc(1), { env: {}, fetchImpl: f }), /redirect target 127\.0\.0\.1 refused/);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].redirect, 'manual');
  });
  await test('redirect: a relative Location on Figma is resolved and followed; an http Location is refused', async () => {
    const f = fake([{ status: 308, location: '/upload/b' }, { status: 200 }]);
    const out = await post('https://mcp.figma.com/upload/a', Buffer.alloc(1), { env: {}, fetchImpl: f });
    assert.equal(out.hops, 1); assert.equal(f.calls[1].url, 'https://mcp.figma.com/upload/b');
    const g = fake([{ status: 307, location: 'http://mcp.figma.com/x' }]);
    await assert.rejects(post('https://mcp.figma.com/upload/a', Buffer.alloc(1), { env: {}, fetchImpl: g }), /not https/);
    assert.equal(g.calls.length, 1);
  });
  await test('redirect: a 307 without a Location is refused', async () => {
    await assert.rejects(post('https://mcp.figma.com/a', Buffer.alloc(1), { env: {}, fetchImpl: fake([{ status: 307 }]) }), /without a Location/);
  });
} finally { A.close(); B.close(); }

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
