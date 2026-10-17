// Animate every color token on one clock. Rapid reversals start at the visible
// palette, so a glass rim can never arrive before its underlying surface.
const root = document.documentElement;
const colorPattern = /#[\da-f]{3,8}\b|rgba?\([^)]*\)/gi;
let frame = 0, initialized = false;
const tokens = new Set();
function collect(rules) {
  for (const rule of rules) {
    if (rule.style && /^:root/.test(rule.selectorText || '')) {
      for (let i = 0; i < rule.style.length; i++) {
        const name = rule.style[i];
        if (name.startsWith('--') && colorPattern.test(rule.style.getPropertyValue(name))) tokens.add(name);
        colorPattern.lastIndex = 0;
      }
    }
    if (rule.cssRules) collect(rule.cssRules);
  }
}
function rgba(value) {
  if (value[0] === '#') {
    let h = value.slice(1);
    if (h.length < 5) h = [...h].map(c => c + c).join('');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1);
  }
  const parts = value.match(/[\d.]+/g).map(Number);
  return parts.length === 3 ? [...parts, 1] : parts;
}
export function transitionTheme(theme, onFinish) {
  cancelAnimationFrame(frame);
  if (!tokens.size) for (const sheet of document.styleSheets) { try { collect(sheet.cssRules); } catch {} }
  const before = getComputedStyle(root), start = new Map(), fromWallpaper=Number(before.getPropertyValue('--wallpaper-night'))||0;
  for (const name of tokens) start.set(name, before.getPropertyValue(name).trim());
  for (const name of tokens) root.style.removeProperty(name);
  root.dataset.theme = theme;
  const toWallpaper=theme==='dark'?1:0;
  const target = getComputedStyle(root), colors = [];
  for (const name of tokens) {
    const a = start.get(name), b = target.getPropertyValue(name).trim();
    const from = (a.match(colorPattern) || []).map(rgba), to = (b.match(colorPattern) || []).map(rgba);
    if (a !== b && from.length && from.length === to.length) colors.push({name, template:b, from, to});
  }
  const finish = () => {
    frame = 0; delete root.dataset.themeTransition;
    for (const name of tokens) root.style.removeProperty(name);
    root.style.removeProperty('--wallpaper-night');
    onFinish?.();
  };
  if (!initialized || matchMedia('(prefers-reduced-motion: reduce)').matches || !colors.length) {
    initialized = true; finish(); return;
  }
  const began = performance.now();
  root.dataset.themeTransition = 'true';
  function paint(now) {
    const p = Math.min(1, (now - began) / 460), eased = p * p * (3 - 2 * p);
    root.style.setProperty('--wallpaper-night',String(fromWallpaper+(toWallpaper-fromWallpaper)*eased));
    for (const {name, template, from, to} of colors) {
      let index = 0;
      root.style.setProperty(name, template.replace(colorPattern, () => {
        const a = from[index], b = to[index++];
        const values = a.map((v, i) => v + (b[i] - v) * eased);
        return `rgba(${values.slice(0, 3).map(Math.round).join(',')},${values[3].toFixed(4)})`;
      }));
    }
    if (p < 1) frame = requestAnimationFrame(paint); else finish();
  }
  paint(began);
}
