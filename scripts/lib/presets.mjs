/**
 * Target presets: one JSON file per kind of web app in scripts/presets/.
 *
 * A preset holds everything that differs between targets, so the capture engine stays generic:
 *   description  what the preset is for
 *   params       the per-run values it needs from the config, each { required?, what?, pattern?, enum?, default? }.
 *                A default may name other params, for example "{pagePath}".
 *   atMostOne    groups of params where only one may be set
 *   warnUnlessAny  [{ keys, message }]: warn when none of the keys is set
 *   signIn       { mode: "chrome" }  you sign in yourself in the dedicated Chrome (SSO, two-factor)
 *                { mode: "form", login: { url, fields: { selector: ENV_VAR }, form?, submit?, success } }
 *                                    a local or test site; the password comes from an environment variable
 *                { mode: "none" }    public pages
 *   css          extra CSS injected before every shot (hide notices, banners, update counts)
 *   release      { source } the default release-check source, for example "wordpress" or "npm:<package>"
 *   actions      named steps and checks a brief can use (see capture.mjs)
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRESET_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'presets');
export const DEFAULT_PRESET = 'p1-editor';
export const SIGN_IN_MODES = ['chrome', 'form', 'none'];

export function listPresets() {
  return readdirSync(PRESET_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
}

// A preset is a name in scripts/presets/ or a path relative to relTo (a brief's directory).
export function presetPath(name, relTo = process.cwd()) {
  const local = join(PRESET_DIR, `${name}.json`);
  if (/^[a-z0-9][a-z0-9-]*$/.test(name) && existsSync(local)) return local;
  const p = resolve(relTo, name);
  if (existsSync(p)) return p;
  throw new Error(`preset "${name}" not found. Built-in presets: ${listPresets().join(', ')}`);
}

export function loadPreset(name, relTo) {
  const file = presetPath(name, relTo);
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf-8')); } catch (e) { throw new Error(`preset ${file} is not valid JSON: ${e.message}`); }
  const p = {
    name, file, description: raw.description || '', params: raw.params || {}, atMostOne: raw.atMostOne || [],
    warnUnlessAny: raw.warnUnlessAny || [], signIn: raw.signIn || { mode: 'none' }, css: raw.css || '',
    release: raw.release || null, actions: raw.actions || {},
  };
  if (!SIGN_IN_MODES.includes(p.signIn.mode)) throw new Error(`preset ${name}: signIn.mode must be one of ${SIGN_IN_MODES.join(', ')}`);
  if (p.signIn.mode === 'form' && !(p.signIn.login?.url && p.signIn.login?.fields)) throw new Error(`preset ${name}: signIn "form" needs login.url and login.fields`);
  return p;
}

// The environment variables a form sign-in reads. Values never appear in a config, brief, or report.
export function signInEnvVars(signIn) {
  return signIn?.mode === 'form' ? Object.values(signIn.login.fields) : [];
}

// Fill each param's default, resolving {other} references against the values given.
export function withDefaults(preset, given) {
  const out = { ...given };
  for (const [k, spec] of Object.entries(preset.params)) {
    if ((out[k] === undefined || out[k] === '') && spec.default !== undefined) {
      out[k] = String(spec.default).replace(/\{(\w+)\}/g, (m, ref) => (out[ref] !== undefined ? out[ref] : m));
    }
  }
  return out;
}
