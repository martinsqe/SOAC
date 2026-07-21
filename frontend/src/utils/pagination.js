import api from '../api/client';

/* Fetches every page of a paginated list endpoint and concatenates the results,
   so callers never silently see only the first page (backend defaults to 50/page). */
export async function fetchAllPages(basePath, itemsKey, limit = 200) {
  const sep = basePath.includes('?') ? '&' : '?';
  const first = await api.get(`${basePath}${sep}page=1&limit=${limit}`);
  const items = [...(first[itemsKey] || [])];
  const totalPages = first.pagination?.pages || 1;

  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        api.get(`${basePath}${sep}page=${i + 2}&limit=${limit}`)
      )
    );
    rest.forEach(d => items.push(...(d[itemsKey] || [])));
  }

  return { items, count: first.count ?? items.length };
}
