// Shared, pure OCR rules. Keep this module independent of Chrome APIs and PaddleOCR.
export const DEFAULT_RULES = Object.freeze({
  length: 6,
  digits: true,
  lowercase: false,
  uppercase: false,
  grayscale: true,
  gaussian: false,
  threshold: true,
  variant: 'auto',
  minConfidence: 0.85,
});
export function normalizeRules(value = {}) {
  const v = value && typeof value === 'object' ? value : {};
  const length = Number(v.length);
  const rules = {
    length: Number.isInteger(length) && length >= 1 && length <= 24 ? length : DEFAULT_RULES.length,
    digits: v.digits === undefined ? true : v.digits === true,
    lowercase: v.lowercase === true,
    uppercase: v.uppercase === true,
    grayscale: v.grayscale !== false,
    gaussian: v.gaussian === true,
    threshold: v.threshold !== false,
    variant: ['auto', 'original', 'processed'].includes(v.variant) ? v.variant : 'auto',
    minConfidence: DEFAULT_RULES.minConfidence,
  };
  if (!rules.digits && !rules.lowercase && !rules.uppercase) throw new Error('Select at least one allowed character type.');
  return rules;
}
export function normalizeText(text) {
  return String(text ?? '').replace(/[^A-Za-z0-9]/g, '');
}
export function matchesRules(text, value) {
  const r = normalizeRules(value);
  if (typeof text !== 'string' || text.length !== r.length) return false;
  const parts = [];
  if (r.digits) parts.push('0-9');
  if (r.lowercase) parts.push('a-z');
  if (r.uppercase) parts.push('A-Z');
  return new RegExp(`^[${parts.join('')}]{${r.length}}$`).test(text);
}
export function originPattern(origin) {
  const url = new URL(origin);
  if (!/^https?:$/.test(url.protocol) || url.origin === 'null') throw new Error('Only http(s) sites can be saved.');
  return `${url.protocol}//${url.hostname}/*`;
}
export function siteKey(url, scope='origin') {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) sites can be saved.');
  return scope === 'path' ? `${u.origin}${u.pathname}` : u.origin;
}
export function matchesSite(rule, url) {
  try {
    const u = new URL(url);
    if (u.origin !== rule.origin) return false;
    return rule.scope !== 'path' || u.pathname === rule.path;
  } catch { return false; }
}
export function findSavedSite(entries, url) {
  return (Array.isArray(entries) ? entries : []).filter(e => e.enabled !== false && matchesSite(e,url))
    .sort((a,b) => (b.scope === 'path') - (a.scope === 'path'))[0] || null;
}
