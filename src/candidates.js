// Pure normalization + selection; deliberately do not fabricate or pad missing characters.
export function normalizeDigits(value) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}
export function fromOcrResult(result, mode) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const candidates = [];
  for (const item of items) {
    const raw = String(item.text ?? '');
    const digits = normalizeDigits(raw);
    if (!digits) continue;
    candidates.push({ digits, raw, mode, score: Number.isFinite(item.score) ? item.score : 0, poly: item.poly });
  }
  // If detection yields a single line per digit, retain reading order using the source box coordinates.
  if (candidates.length > 1) {
    const ordered = [...candidates].sort((a,b) => getCenter(a.poly).x - getCenter(b.poly).x);
    const joined = ordered.map(i => i.digits).join('');
    if (joined.length === 6) candidates.push({
      digits: joined, raw: ordered.map(i => i.raw).join(' '), mode,
      score: ordered.reduce((sum, i) => sum + i.score, 0) / ordered.length,
      grouped: true,
    });
  }
  return candidates;
}
function getCenter(poly) {
  if (!Array.isArray(poly) || !poly.length) return {x: 0};
  const points = Array.isArray(poly[0]) ? poly : [];
  return {x: points.reduce((sum, p) => sum + (Number(p[0]) || 0), 0) / Math.max(1, points.length)};
}
export function chooseCandidate(candidates) {
  const exact = candidates.filter(c => c.digits.length === 6);
  if (!exact.length) return null;
  return [...exact].sort((a, b) => b.score - a.score)[0];
}
