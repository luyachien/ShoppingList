const API = 'https://api.notion.com/v1';
const VERSION = '2025-09-03';

export class NotionError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function notion(path, { method = 'GET', body } = {}) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('NOTION_TOKEN is not set');

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    // Notion 限速時回 429；短暫等待後重試，避免旅伴連續點擊時整個失敗
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min(Number(res.headers.get('Retry-After')) || 1, 3);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new NotionError(res.status, data.code, data.message);
    return data;
  }
}

export async function queryAll(dataSourceId, body = {}) {
  const results = [];
  let cursor;
  do {
    const page = await notion(`/data_sources/${dataSourceId}/query`, {
      method: 'POST',
      body: { ...body, page_size: 100, start_cursor: cursor },
    });
    results.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return results;
}

// 同一個 serverless 實例內重複使用，減少 Notion 請求
const dataSourceCache = new Map();

export async function getDatabase(databaseId) {
  const db = await notion(`/databases/${databaseId}`);
  if (db.data_sources?.[0]) dataSourceCache.set(db.id, db.data_sources[0].id);
  return db;
}

export async function getDataSourceId(databaseId) {
  const key = formatId(databaseId);
  if (!dataSourceCache.has(key)) {
    const db = await getDatabase(key);
    if (!db.data_sources?.[0]) throw new NotionError(404, 'no_data_source', 'Database has no data source');
  }
  return dataSourceCache.get(key);
}

export function plainText(richText = []) {
  return richText.map((t) => t.plain_text).join('');
}

// 從任何 Notion 網址（notion.so、notion.site、app.notion.com）或純 ID 取出 32 碼 ID
export function extractNotionId(input) {
  const text = String(input || '').trim();
  let target = text;
  try {
    target = new URL(text).pathname;
  } catch {
    // 不是網址，當作純 ID
  }
  const matches = target.match(
    /(?<![0-9a-f])([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f])/gi,
  );
  return matches ? formatId(matches[matches.length - 1]) : null;
}

export function formatId(id) {
  const hex = String(id).replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// 網址可能指向 Database 本身，或是內含 Database 的頁面（例如「購物清單」頁）
export async function resolveDatabase(id) {
  try {
    return await getDatabase(id);
  } catch (err) {
    if (!(err instanceof NotionError) || ![400, 404].includes(err.status)) throw err;
  }
  const children = await notion(`/blocks/${id}/children?page_size=100`).catch((err) => {
    if (err instanceof NotionError && [400, 404].includes(err.status)) return null;
    throw err;
  });
  const child = children?.results.find((b) => b.type === 'child_database');
  return child ? getDatabase(child.id) : null;
}
