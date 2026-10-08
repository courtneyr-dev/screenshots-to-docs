/* Builds the screenshot annotation kit in the current Figma file from KIT (kit.json).
   Shared by the plugin (code.js) and its tests. Plain script: no imports, Plugin API only. */

/* eslint-disable no-unused-vars */
async function buildKit(KIT, opts) {
  opts = opts || {};
  const suffix = opts.suffix || '';
  const report = { variablesCreated: 0, variablesReused: 0, libraryAliases: 0, localFallbacks: 0, components: 0, nodes: 0, warnings: [] };

  for (const style of ['Regular', 'Semi Bold', 'Bold']) await figma.loadFontAsync({ family: 'Inter', style });

  // ---- variables ----
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const getCollection = name => collections.find(c => c.name === name + suffix) || (() => { const c = figma.variables.createVariableCollection(name + suffix); collections.push(c); return c; })();
  const allVars = await figma.variables.getLocalVariablesAsync();
  const byName = {};
  for (const v of allVars) byName[v.variableCollectionId + '|' + v.name] = v;
  const rgba = c => ({ r: c.r, g: c.g, b: c.b, a: c.a === undefined ? 1 : c.a });
  const ensure = (collection, name, type) => {
    const key = collection.id + '|' + name;
    if (byName[key]) { report.variablesReused++; return { v: byName[key], fresh: false }; }
    const v = figma.variables.createVariable(name, collection, type);
    byName[key] = v; report.variablesCreated++;
    return { v, fresh: true };
  };
  const primitives = getCollection('Annotation primitives');
  const vars = {};
  // Primitives first, so semantic variables can alias them.
  for (const col of KIT.variables) {
    if (col.name !== 'Annotation primitives') continue;
    for (const spec of col.vars) {
      const { v, fresh } = ensure(primitives, spec.name, spec.type);
      if (fresh) { v.setValueForMode(primitives.modes[0].modeId, spec.type === 'COLOR' ? rgba(spec.values.Value) : spec.values.Value); v.scopes = spec.scopes; }
      vars[spec.name] = v;
    }
  }
  for (const col of KIT.variables) {
    if (col.name === 'Annotation primitives') continue;
    const collection = getCollection(col.name);
    const mode = collection.modes[0].modeId;
    for (const spec of col.vars) {
      const { v, fresh } = ensure(collection, spec.name, spec.type);
      vars[spec.name] = v;
      if (!fresh) continue;
      v.description = spec.description || '';
      v.scopes = spec.scopes;
      const val = spec.values.Value;
      if (val && val.alias) {
        let target = null;
        if (val.remote && val.libraryVariable) {
          // The PDS library when it's enabled for this file; otherwise a local primitive with the same value.
          try { target = await figma.variables.importVariableByKeyAsync(val.libraryVariable); report.libraryAliases++; } catch (e) { target = null; }
        }
        if (!target && !val.remote) target = vars[val.alias];
        if (!target) {
          const p = ensure(primitives, val.alias, spec.type);
          if (p.fresh) { p.v.setValueForMode(primitives.modes[0].modeId, rgba(val.value)); p.v.scopes = []; }
          target = p.v; vars[val.alias] = target; report.localFallbacks++;
        }
        v.setValueForMode(mode, { type: 'VARIABLE_ALIAS', id: target.id });
      } else {
        v.setValueForMode(mode, spec.type === 'COLOR' ? rgba(val) : val);
      }
    }
  }

  // ---- page ----
  const pageName = 'Annotation kit · Components' + suffix;
  let page = opts.pageId ? await figma.getNodeByIdAsync(opts.pageId) : null;
  if (!page) {
    const taken = figma.root.children.some(p => p.name === pageName);
    if (taken) report.warnings.push('A page named "' + pageName + '" already exists; the kit was built on a new, dated page.');
    page = figma.createPage();
    page.name = taken ? pageName + ' (' + new Date().toISOString().slice(0, 10) + ')' : pageName;
  }
  await figma.setCurrentPageAsync(page);

  // ---- nodes ----
  const paint = (p, fallback) => {
    if (p.t !== 'SOLID') return null;
    const color = p.c ? { r: p.c[0], g: p.c[1], b: p.c[2] } : { r: 0.5, g: 0.5, b: 0.5 };
    let out = { type: 'SOLID', color };
    if (p.o !== undefined) out.opacity = p.o;
    if (p.hide) out.visible = false;
    if (p.v) {
      if (!vars[p.v]) { report.warnings.push('Unknown variable ' + p.v + ' on ' + fallback); return out; }
      out = figma.variables.setBoundVariableForPaint(out, 'color', vars[p.v]);
    }
    return out;
  };
  const paints = (list, where) => (list || []).map(p => paint(p, where)).filter(Boolean);
  const frameLike = k => k === 'COMPONENT' || k === 'FRAME';

  function create(spec) {
    switch (spec.k) {
      case 'COMPONENT': return figma.createComponent();
      case 'FRAME': return figma.createFrame();
      case 'RECTANGLE': return figma.createRectangle();
      case 'ELLIPSE': return figma.createEllipse();
      case 'POLYGON': { const n = figma.createPolygon(); n.pointCount = spec.pc || 3; return n; }
      case 'LINE': return figma.createLine();
      case 'VECTOR': return figma.createVector();
      case 'TEXT': return figma.createText();
      default: throw new Error('Unsupported node type ' + spec.k);
    }
  }

  async function style(node, spec, parentAutoLayout) {
    const [x, y, w, h] = spec.g;
    node.name = spec.n;
    if (frameLike(spec.k)) { node.fills = []; node.clipsContent = !!spec.clip; }
    if (spec.k === 'TEXT') {
      const [chars, family, fstyle, size, ha, va, auto] = spec.tx;
      node.fontName = { family, style: fstyle };
      node.fontSize = size;
      node.characters = chars;
      node.textAlignHorizontal = ha; node.textAlignVertical = va;
      if (spec.lh) node.lineHeight = spec.lh;
      if (spec.lsp) node.letterSpacing = spec.lsp;
      node.textAutoResize = auto;
      if (auto !== 'WIDTH_AND_HEIGHT') node.resize(w, h);
      node.textAutoResize = auto;
    } else if (spec.k === 'VECTOR') {
      if (spec.net) await node.setVectorNetworkAsync(spec.net);
      else node.vectorPaths = spec.p.map(([windingRule, data]) => ({ windingRule, data }));
    } else if (spec.k === 'LINE') {
      node.resize(w, 0);
    } else if (!(spec.al && spec.al[8] === 'AUTO' && spec.al[9] === 'AUTO')) {
      node.resize(Math.max(w, 0.01), Math.max(h, 0.01));
    }
    if (spec.al) {
      const [mode, pt, pr, pb, pl, gap, pa, ca, ps, cs] = spec.al;
      node.layoutMode = mode;
      node.paddingTop = pt; node.paddingRight = pr; node.paddingBottom = pb; node.paddingLeft = pl;
      node.itemSpacing = gap; node.primaryAxisAlignItems = pa; node.counterAxisAlignItems = ca;
      node.primaryAxisSizingMode = ps; node.counterAxisSizingMode = cs;
    }
    if ('fills' in node) node.fills = paints(spec.f, spec.n);
    if (spec.s) {
      node.strokes = paints(spec.s, spec.n);
      if (spec.sa) node.strokeAlign = spec.sa;
      if (spec.cap && 'strokeCap' in node && !spec.net) node.strokeCap = spec.cap;
      if (spec.join && 'strokeJoin' in node && !spec.net) node.strokeJoin = spec.join;
      if (Array.isArray(spec.sw)) { node.strokeTopWeight = spec.sw[0]; node.strokeRightWeight = spec.sw[1]; node.strokeBottomWeight = spec.sw[2]; node.strokeLeftWeight = spec.sw[3]; }
      else node.strokeWeight = spec.sw;
      if (spec.dash) node.dashPattern = spec.dash;
    }
    if (spec.r !== undefined && 'cornerRadius' in node) {
      if (Array.isArray(spec.r)) { node.topLeftRadius = spec.r[0]; node.topRightRadius = spec.r[1]; node.bottomRightRadius = spec.r[2]; node.bottomLeftRadius = spec.r[3]; }
      else node.cornerRadius = spec.r;
    }
    if (spec.fx) {
      node.effects = spec.fx.map(e => {
        if (e.type === 'BACKGROUND_BLUR' || e.type === 'LAYER_BLUR') return { type: e.type, radius: e.radius, visible: e.visible !== false, blurType: 'NORMAL' };
        return { type: e.type, radius: e.radius, visible: e.visible !== false, color: e.color, offset: e.offset, spread: e.spread || 0, blendMode: e.blendMode || 'NORMAL' };
      });
    }
    if (spec.b) {
      for (const [field, name] of Object.entries(spec.b)) {
        if (!vars[name]) { report.warnings.push('Unknown variable ' + name + ' for ' + spec.n + '.' + field); continue; }
        try { node.setBoundVariable(field, vars[name]); } catch (e) { report.warnings.push('Could not bind ' + field + ' on ' + spec.n + ': ' + e.message); }
      }
    }
    if (spec.op !== undefined) node.opacity = spec.op;
    if (spec.hide) node.visible = false;
    if (spec.cn) node.constraints = { horizontal: spec.cn[0], vertical: spec.cn[1] };
    if (parentAutoLayout) {
      if (spec.abs) node.layoutPositioning = 'ABSOLUTE';
      if (spec.ls && !spec.abs) { node.layoutSizingHorizontal = spec.ls[0]; node.layoutSizingVertical = spec.ls[1]; }
    }
    if (spec.rot) node.rotation = spec.rot;
    if (!parentAutoLayout || spec.abs) { node.x = x; node.y = y; }
  }

  async function build(spec, parent, parentAutoLayout) {
    const node = create(spec);
    parent.appendChild(node);
    report.nodes++;
    if (spec.ch && spec.ch.length) {
      // Give the parent its final size before any child exists, so constraints don't move children later.
      const hug = spec.al && spec.al[8] === 'AUTO' && spec.al[9] === 'AUTO';
      if (!hug) node.resize(Math.max(spec.g[2], 0.01), Math.max(spec.g[3], 0.01));
      if (spec.al) node.layoutMode = spec.al[0];
      for (const c of spec.ch) await build(c, node, !!spec.al);
    }
    await style(node, spec, parentAutoLayout);
    // Hug-sized auto-layout frames change size while styling; place absolute children against the final size.
    if (spec.al && spec.ch) spec.ch.forEach((c, i) => { if (c.abs) { const child = node.children[i]; child.x = c.g[0]; child.y = c.g[1]; } });
    return node;
  }

  const propRefs = [];
  async function buildTop(spec) {
    if (spec.k === 'COMPONENT') {
      const comp = await build(spec, page, false);
      if (spec.d) comp.description = spec.d;
      report.components++;
      return comp;
    }
    // COMPONENT_SET: build variants, combine, then add text and boolean properties and rebind references.
    const variants = [];
    for (const c of spec.ch) variants.push(await build(c, page, false));
    const set = figma.combineAsVariants(variants, page);
    report.nodes++;
    set.name = spec.n;
    set.fills = paints(spec.f, spec.n);
    if (spec.r) set.cornerRadius = spec.r;
    if (spec.d) set.description = spec.d;
    const idMap = {};
    for (const [key, def] of Object.entries(spec.defs || {})) {
      if (def.type === 'VARIANT') continue;
      idMap[key] = set.addComponentProperty(key.split('#')[0], def.type, def.defaultValue);
    }
    const walk = (node, s) => {
      if (s.ref) { const refs = {}; for (const [f, k] of Object.entries(s.ref)) if (idMap[k]) refs[f] = idMap[k]; if (Object.keys(refs).length) propRefs.push([node, refs]); }
      if (s.ch && 'children' in node) s.ch.forEach((cs, i) => node.children[i] && walk(node.children[i], cs));
    };
    spec.ch.forEach((cs, i) => { const v = set.children.find(n => n.name === cs.n) || variants[i]; v.x = cs.g[0]; v.y = cs.g[1]; walk(v, cs); });
    set.resizeWithoutConstraints(spec.g[2], spec.g[3]);
    report.components += variants.length;
    return set;
  }

  const only = opts.only ? new Set(opts.only) : null;
  const created = [];
  for (const spec of KIT.components) {
    if (only && !only.has(spec.n)) continue;
    const top = await buildTop(spec);
    top.x = spec.g[0]; top.y = spec.g[1];
    created.push(top);
  }
  for (const [node, refs] of propRefs) node.componentPropertyReferences = refs;

  report.page = page.name;
  report.pageId = page.id;
  report.created = created.map(n => n.name);
  return report;
}
