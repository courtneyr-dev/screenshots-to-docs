#!/usr/bin/env node
/**
 * screenshots-to-docs / figma-annotation
 *
 * Prints the Figma Plugin API code that reads an annotated frame (and its clean frame) out of Figma as an
 * annotation manifest, so record-annotation.mjs can verify it. Run the code with `use_figma`, save its
 * return value as a JSON file, and pass that file to record-annotation.mjs --manifest.
 *
 * Usage:
 *   node figma-annotation.mjs --clean-node-id 84:13 --annotated-node-id 87:2 [--out extract.js]
 *
 * What the code reads (nothing is written to the file): both frames' sizes, names, and screenshot image
 * hashes; every top-level layer of the annotated frame, with its kit component, variant, kit stamp, colors,
 * fonts, geometry, and text; the Annotation variables; the token hash the plugin stamped on the file; and the
 * target and sensitive-region data placed with setSharedPluginData('s2d', ...). See
 * docs/reference/annotation-kit.md for that protocol.
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { MANIFEST_SCHEMA, PLUGIN_NS } from './lib/annotation.mjs';

const NODE_ID = /^\d+:\d+$/;

export function extractCode({ cleanNodeId, annotatedNodeId }) {
  for (const [k, v] of [['clean node ID', cleanNodeId], ['annotated node ID', annotatedNodeId]]) {
    if (!NODE_ID.test(v || '')) throw new Error(`${k} "${v}" is not a Figma node ID such as 87:2`);
  }
  return `const NS = ${JSON.stringify(PLUGIN_NS)};
const CLEAN_ID = ${JSON.stringify(cleanNodeId)};
const ANNOTATED_ID = ${JSON.stringify(annotatedNodeId)};
const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const solid = list => (list === figma.mixed || !list ? [] : list).filter(p => p.visible !== false);
const paintOut = p => (p.type === 'SOLID' ? { type: 'SOLID', hex: hex(p.color), opacity: p.opacity === undefined ? 1 : p.opacity } : p.type === 'IMAGE' ? { type: 'IMAGE', imageHash: p.imageHash } : { type: p.type });
const parse = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };

const clean = await figma.getNodeByIdAsync(CLEAN_ID);
const frame = await figma.getNodeByIdAsync(ANNOTATED_ID);
if (!clean || !frame) throw new Error('Clean or annotated frame not found. Check the node IDs and that the file is open.');
const origin = frame.absoluteBoundingBox;
const rel = n => { const b = n.absoluteBoundingBox; return b ? [b.x - origin.x, b.y - origin.y, b.width, b.height] : [0, 0, 0, 0]; };
const imageOf = n => { const p = solid(n.fills).find(x => x.type === 'IMAGE'); return p ? { id: n.id, width: n.width, height: n.height, imageHash: p.imageHash } : null; };

const cleanRect = clean.type === 'RECTANGLE' ? clean : clean.findOne(n => n.type === 'RECTANGLE' && imageOf(n));
const cleanImage = cleanRect ? imageOf(cleanRect) : null;
const shotRect = frame.findOne(n => n.name === 'screenshot' && n.type === 'RECTANGLE');
const annotatedImage = shotRect ? imageOf(shotRect) : null;

const surfaceOf = (node, stop) => {
  for (let n = node; n; n = n.parent) {
    const p = n.type !== 'TEXT' && 'fills' in n ? solid(n.fills).find(x => x.type === 'SOLID' && (x.opacity === undefined || x.opacity === 1)) : null;
    if (p) return hex(p.color);
    if (n === stop) break;
  }
  return null;
};

const nodes = [];
for (const n of frame.children) {
  const rec = { id: n.id, name: n.name, type: n.type, bbox: rel(n), visible: n.visible, opacity: n.opacity === undefined ? 1 : n.opacity, rotation: n.rotation || 0 };
  if (n === shotRect) { rec.fills = solid(n.fills).map(paintOut); nodes.push(rec); continue; }
  const parts = 'findAll' in n ? [n, ...n.findAll(() => true)] : [n];
  rec.fills = []; rec.strokes = []; rec.texts = [];
  let strokeMax;
  for (const d of parts) {
    if (d.type === 'TEXT') {
      const fn = d.fontName === figma.mixed ? { family: 'mixed', style: 'mixed' } : d.fontName;
      const fill = solid(d.fills).find(x => x.type === 'SOLID');
      rec.texts.push({ characters: d.characters, family: fn.family, style: fn.style, size: d.fontSize === figma.mixed ? 0 : d.fontSize, autoResize: d.textAutoResize, truncation: d.textTruncation, bbox: rel(d), fillHex: fill ? hex(fill.color) : null, surfaceHex: surfaceOf(d.parent, n) });
      continue;
    }
    if ('fills' in d) rec.fills.push(...solid(d.fills).map(paintOut));
    if ('strokes' in d && d.strokes.length) {
      rec.strokes.push(...solid(d.strokes).map(paintOut));
      if (typeof d.strokeWeight === 'number' && d.name !== 'halo') strokeMax = Math.max(strokeMax || 0, d.strokeWeight);
    }
  }
  if (strokeMax !== undefined) rec.strokeMax = strokeMax;
  const markPart = parts.find(d => d.name === 'mark' && d.type !== 'TEXT');
  const markPaint = markPart ? (solid(markPart.strokes).find(x => x.type === 'SOLID') || solid(markPart.fills).find(x => x.type === 'SOLID')) : null;
  if (markPaint) rec.markHex = hex(markPaint.color);
  if (n.type === 'INSTANCE') {
    const main = await n.getMainComponentAsync();
    const set = main && main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : null;
    rec.component = { set: set ? set.name : null, name: main ? main.name : null, variant: n.variantProperties || {}, kitStamp: main ? ((set || main).getSharedPluginData(NS, 'kit') || null) : null, remote: main ? !!main.remote : false };
  }
  const target = parse(n.getSharedPluginData(NS, 'target'));
  if (target) rec.target = target;
  nodes.push(rec);
}

const kitVariables = {};
const cols = await figma.variables.getLocalVariableCollectionsAsync();
const col = cols.find(c => c.name === 'Annotation');
if (col) {
  for (const vid of col.variableIds) {
    let v = await figma.variables.getVariableByIdAsync(vid);
    let val = v.valuesByMode[col.defaultModeId];
    for (let i = 0; i < 5 && val && val.type === 'VARIABLE_ALIAS'; i++) {
      v = await figma.variables.getVariableByIdAsync(val.id);
      val = v.valuesByMode[Object.keys(v.valuesByMode)[0]];
    }
    kitVariables[(await figma.variables.getVariableByIdAsync(vid)).name] = val && typeof val === 'object' ? hex(val) : val;
  }
}

return {
  schema: ${JSON.stringify(MANIFEST_SCHEMA)},
  extractedAt: new Date().toISOString(),
  fileKey: figma.fileKey || null,
  tokens: { schemaVersion: Number(figma.root.getSharedPluginData(NS, 'tokensSchema')) || 0, hash: figma.root.getSharedPluginData(NS, 'tokensHash') || '' },
  cleanFrame: { id: clean.id, name: clean.name, width: cleanImage ? cleanImage.width : clean.width, height: cleanImage ? cleanImage.height : clean.height, screenshot: cleanImage },
  annotatedFrame: { id: frame.id, name: frame.name, width: frame.width, height: frame.height, clipsContent: frame.clipsContent, screenshot: annotatedImage },
  kitVariables,
  nodes,
  sensitive: parse(frame.getSharedPluginData(NS, 'sensitive')) || [],
  keepClear: parse(frame.getSharedPluginData(NS, 'keepClear')) || [],
};
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { 'clean-node-id': { type: 'string' }, 'annotated-node-id': { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help || !values['clean-node-id'] || !values['annotated-node-id']) {
    console.log('Usage: node figma-annotation.mjs --clean-node-id <id> --annotated-node-id <id> [--out extract.js]\nPrints the use_figma code that reads the frames out of Figma as an annotation manifest.');
    process.exit(values.help ? 0 : 1);
  }
  let code;
  try { code = extractCode({ cleanNodeId: values['clean-node-id'], annotatedNodeId: values['annotated-node-id'] }); } catch (e) { console.error(`FAIL: ${e.message}`); process.exit(1); }
  if (values.out) { writeFileSync(values.out, code); console.log(`Wrote ${values.out}. Run it with use_figma, save the returned JSON, and pass it to record-annotation.mjs --manifest.`); } else process.stdout.write(code);
}
