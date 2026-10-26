export const modes = { system: 'Sistem', light: 'Açık', dark: 'Koyu' };
export const accents = { teal: 'Petrol', blue: 'Mavi', copper: 'Bakır', rose: 'Gül' };
export function normalizeAppearance(value) {
  return { mode: Object.hasOwn(modes, value?.mode) ? value.mode : 'system', accent: Object.hasOwn(accents, value?.accent) ? value.accent : 'teal' };
}
export function loadAppearance(storage) {
  try { return normalizeAppearance(JSON.parse(storage.getItem('workspace.appearance'))); }
  catch { return normalizeAppearance(null); }
}
export function applyAppearance(value, root, systemDark) {
  const next = normalizeAppearance(value);
  root.dataset.theme = next.mode === 'system' ? (systemDark ? 'dark' : 'light') : next.mode;
  root.dataset.accent = next.accent;
  return next;
}
