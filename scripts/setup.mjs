#!/usr/bin/env node
/**
 * screenshots-to-docs / setup — one command for everything:
 *
 *   npm run setup                  walk through every step (each can be skipped, each is safe to rerun)
 *   npm run setup -- --status      show what is set up, change nothing
 *   npm run setup -- --only kit    run one step: tools | config | kit | markdown | gdocs
 *
 * Steps
 *   tools     Node, dependencies, Chrome (scripts/setup.sh)
 *   config    p1-editor.config.json for captures, checked by preflight
 *   kit       the Figma annotation kit plugin (import once, run in any file)
 *   markdown  screenshots.map.json in a Markdown docs repository
 *   gdocs     the Google Docs swap: Apps Script project via clasp, plus the read-only GitHub token
 *
 * This script never asks for, prints, or stores a password or token. The GitHub token is created on
 * github.com and pasted by you into the Apps Script project's settings; Google sign-in happens in your browser.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, platform } from 'node:process';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
export const CLASP = ['--yes', '@google/clasp@3.4.1'];
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** github.com form for a fine-grained token that can only read one repository's contents. */
export function tokenUrl(repo) {
  if (!REPO_RE.test(repo)) throw new Error('repository must look like owner/name');
  const [owner, name] = repo.split('/');
  const q = new URLSearchParams({
    name: `P1 screenshot swap (${name})`.slice(0, 40),
    description: `Read-only access for the Google Docs screenshot swap. Repository: ${repo}`,
    target_name: owner,
    expires_in: '90',
    contents: 'read',
  });
  return `https://github.com/settings/personal-access-tokens/new?${q}`;
}

/** Writes the Apps Script project folder that clasp pushes: Code.gs, Config.gs, appsscript.json. */
export function writeAppsScriptProject(dir, { repo, manifestPath, manifestRef }) {
  if (!REPO_RE.test(repo)) throw new Error('repository must look like owner/name');
  if (!manifestPath || manifestPath.startsWith('/') || manifestPath.split('/').includes('..')) throw new Error('manifest path must be a path inside the repository');
  if (manifestRef && !/^[0-9a-f]{40}$/.test(manifestRef)) throw new Error('manifest commit must be a full 40-character SHA');
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(ROOT, 'templates', 'gdocs-swap', 'Code.gs'), join(dir, 'Code.gs'));
  copyFileSync(join(ROOT, 'templates', 'gdocs-swap', 'appsscript.json'), join(dir, 'appsscript.json'));
  const cfg = { MANIFEST_REPO: repo, MANIFEST_PATH: manifestPath, ...(manifestRef ? { MANIFEST_REF: manifestRef } : {}) };
  writeFileSync(join(dir, 'Config.gs'), [
    '/* Written by npm run setup. Non-secret settings only: the GitHub token is a script property, never a file.',
    '   Update MANIFEST_REF for each release (or set it as a script property, which wins). */',
    `var SWAP_CONFIG = ${JSON.stringify(cfg, null, 2)};`,
    '',
  ].join('\n'));
  return cfg;
}

function status() {
  const has = p => existsSync(join(ROOT, p));
  const kitCurrent = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build-figma-plugin.mjs'), '--check'], { encoding: 'utf-8' }).status === 0;
  return [
    ['tools', has('node_modules/puppeteer-core'), 'dependencies installed'],
    ['config', has('p1-editor.config.json'), 'p1-editor.config.json'],
    ['kit', kitCurrent, 'figma-plugin/code.js built and current'],
    ['gdocs', has('build/gdocs-swap/.clasp.json'), 'Apps Script project created (build/gdocs-swap)'],
  ];
}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts }).status === 0;
const openUrl = url => { const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open'; spawnSync(cmd, [url], { stdio: 'ignore', shell: platform === 'win32' }); };

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(readFileSync(new URL(import.meta.url), 'utf-8').split('\n').slice(2, 21).map(l => l.replace(/^ \* ?/, '')).join('\n'));
    return;
  }
  if (args.includes('--status')) {
    for (const [step, ok, what] of status()) console.log(`${ok ? 'OK  ' : 'TODO'}  ${step.padEnd(8)} ${what}`);
    return;
  }
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = async (q, def = '') => ((await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim() || def);
  const yes = async q => /^y/i.test(await ask(`${q} (y/n)`, 'y'));
  const want = async (step, title) => (only ? only === step : await yes(`\n== ${title}. Set it up now?`));

  try {
    if (await want('tools', 'Tools: Node, dependencies, Chrome')) {
      if (!run('bash', ['scripts/setup.sh'])) throw new Error('scripts/setup.sh failed');
    }

    if (await want('config', 'Capture config (p1-editor.config.json)')) {
      const file = join(ROOT, 'p1-editor.config.json');
      if (existsSync(file) && !(await yes('p1-editor.config.json exists. Replace it?'))) console.log('Kept the existing config.');
      else {
        const cfg = JSON.parse(readFileSync(join(ROOT, 'examples', 'config.example.json'), 'utf-8'));
        delete cfg.$comment; delete cfg.blockType;
        cfg.topic = await ask('Short name for these runs (kebab-case)', 'p1-docs');
        cfg.baseUrl = await ask('P1 site origin', 'http://localhost:3000');
        cfg.projectName = await ask('Project name as the editor header shows it');
        cfg.workstream = await ask('Workstream name as the selector lists it');
        cfg.pagePath = await ask('Page path to capture', '/');
        cfg.chrome = { profileDir: await ask('Dedicated Chrome profile folder (outside any repo)', '~/.cache/p1-screenshots-profile'), cdpPort: Number(await ask('Chrome debugging port', '9222')) };
        cfg.figma.fileKey = await ask('Figma file key (from figma.com/design/<key>/...)');
        cfg.figma.pageNamePattern = 'RUN-{date} · {runId}';
        cfg.docs.handoffDir = await ask('Folder for handoff notes', './handoff');
        writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
        console.log(`Wrote ${file} (git-ignored).`);
      }
      run(process.execPath, ['scripts/preflight.mjs', '--config', 'p1-editor.config.json', '--need', 'capture,figma,handoff']);
    }

    if (await want('kit', 'Figma annotation kit (plugin)')) {
      if (!run(process.execPath, ['scripts/build-figma-plugin.mjs', '--check'])) run(process.execPath, ['scripts/build-figma-plugin.mjs']);
      const manifest = join(ROOT, 'figma-plugin', 'manifest.json');
      console.log([
        '',
        'In the Figma desktop app (once per computer):',
        '  1. Open any design file. Menu: Plugins > Development > Import plugin from manifest...',
        `  2. Choose ${manifest}`,
        'In each file that needs the kit:',
        '  3. Plugins > Development > P1 screenshot annotation kit',
        'It adds the "Annotation" variables and an "Annotation kit · Components" page with 13 components: 11 sets with 70 variants, plus 2 single components.',
        'If the Pantheon Design System library is enabled for the file, colors alias it; otherwise they use the same values locally.',
      ].join('\n'));
      if (platform === 'darwin' && (await yes('Show the manifest in Finder?'))) spawnSync('open', ['-R', manifest]);
    }

    if (await want('markdown', 'Markdown docs repository')) {
      const repo = await ask('Path to the docs repository (blank to skip)');
      if (repo) {
        const map = join(resolve(repo), 'screenshots.map.json');
        if (existsSync(map)) console.log(`${map} exists; publish-markdown will use it.`);
        else {
          writeFileSync(map, JSON.stringify({ images: { '<screenshot id>': 'docs/images/<file>.png' } }, null, 2) + '\n');
          console.log(`Wrote ${map}. Map each screenshot ID to the image file its pages embed.`);
        }
        console.log(`Swap a release with: node scripts/publish-markdown.mjs --inventory <inventory> --assets-dir <assets> --repo ${repo} --branch screenshots/<release>`);
      }
    }

    if (await want('gdocs', 'Google Docs swap (Apps Script + read-only GitHub token)')) {
      const repo = await ask('GitHub repository that holds the screenshots and manifests (owner/name)');
      const manifestPath = await ask('Manifest path in that repository', 'release-swap/manifest.json');
      const manifestRef = await ask('Commit the manifest is pinned to (40 characters; blank to set later)');
      const dir = join(ROOT, 'build', 'gdocs-swap');
      writeAppsScriptProject(dir, { repo, manifestPath, manifestRef: manifestRef || null });
      console.log(`Wrote ${dir} (Code.gs, Config.gs, appsscript.json).`);

      console.log('\nGoogle sign-in: clasp opens your browser. First, turn on "Google Apps Script API" for your account.');
      openUrl('https://script.google.com/home/usersettings');
      await ask('Press Enter when the Apps Script API is on');
      if (!run('npx', [...CLASP, 'login'])) throw new Error('clasp login failed');
      if (!existsSync(join(dir, '.clasp.json'))) {
        if (!run('npx', [...CLASP, 'create-script', '--type', 'standalone', '--title', 'P1 screenshot swap', '--rootDir', '.'], { cwd: dir })) throw new Error('clasp create-script failed');
      }
      if (!run('npx', [...CLASP, 'push', '--force'], { cwd: dir })) throw new Error('clasp push failed');

      const url = tokenUrl(repo);
      console.log([
        '',
        'GitHub token (read-only, this repository only). GitHub opens a form with everything filled in except one choice:',
        `  Repository access: choose "Only select repositories" and pick ${repo}. Then Generate token and copy it.`,
        'Then, in the Apps Script project (opening next): Project Settings > Script properties > Add script property:',
        '  Property: GITHUB_TOKEN    Value: the token. Click Save script properties.',
        'Never paste the token into this terminal, a file, or a chat.',
      ].join('\n'));
      openUrl(url);
      await ask('Press Enter when you have copied the token');
      run('npx', [...CLASP, 'open-script'], { cwd: dir });
      console.log('\nLast: in the editor, run dryRunSwap and approve the Docs and external-request access when Google asks.');
    }
  } finally {
    rl.close();
  }
  console.log('\nStatus:');
  for (const [step, ok, what] of status()) console.log(`  ${ok ? 'OK  ' : 'TODO'}  ${step.padEnd(8)} ${what}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(`FAIL: ${e.message}`); process.exit(1); });
