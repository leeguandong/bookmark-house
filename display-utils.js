export function normalizedUrl(raw) {
  try { return new URL(raw).href; } catch { return raw; }
}

export function findDuplicates(bookmarks) {
  const byUrl = new Map();
  for (const b of bookmarks) {
    if (b.inTrash) continue;
    const key = normalizedUrl(b.url);
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(b);
  }
  return [...byUrl.values()].filter(g => g.length > 1).map(g => g.sort((a,b) => (a.dateAdded || 0) - (b.dateAdded || 0) || a.id.localeCompare(b.id)));
}


export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));