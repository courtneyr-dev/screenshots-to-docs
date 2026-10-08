/* Plugin entry: build the kit, report what happened, close. */
(async () => {
  try {
    const r = await buildKit(KIT, {});
    const fallback = r.localFallbacks ? ' ' + r.localFallbacks + ' PDS colors used local values (enable the PDS library to alias them).' : '';
    figma.notify('Annotation kit built: ' + r.components + ' components on "' + r.page + '".' + fallback, { timeout: 8000 });
    if (r.warnings.length) console.warn(r.warnings.join('\n'));
    figma.closePlugin();
  } catch (e) {
    figma.closePlugin('Annotation kit failed: ' + e.message);
  }
})();
