// 「轉換紀錄」Database 的讀寫；每筆紀錄 = 一個分享出去的清單
import { randomBytes } from 'node:crypto';
import { HttpError } from './http.js';
import { getDataSourceId, notion, NotionError, plainText, queryAll } from './notion.js';

const P = {
  name: '名稱',
  slug: 'slug',
  databaseId: 'Database ID',
  hash: '密碼雜湊',
  hint: '密碼提示',
  enabled: '啟用',
  created: '建立時間',
};

async function registryDataSource() {
  const id = process.env.NOTION_REGISTRY_DATABASE_ID;
  if (!id) throw new Error('NOTION_REGISTRY_DATABASE_ID is not set');
  return getDataSourceId(id);
}

function toRecord(page) {
  const p = page.properties;
  return {
    pageId: page.id,
    name: plainText(p[P.name]?.title),
    slug: plainText(p[P.slug]?.rich_text),
    databaseId: plainText(p[P.databaseId]?.rich_text),
    hash: plainText(p[P.hash]?.rich_text),
    // 較早建立的轉換紀錄可能沒有這個欄位，視為沒有提示
    hint: plainText(p[P.hint]?.rich_text),
    enabled: !!p[P.enabled]?.checkbox,
    createdTime: p[P.created]?.created_time ?? page.created_time,
  };
}

const text = (content) => ({ rich_text: content ? [{ type: 'text', text: { content } }] : [] });

// 「密碼提示」是後來加的欄位；轉換紀錄缺少它時，回傳明確的設定說明而不是 Notion 原始錯誤
async function writeRegistry(path, method, body, touchesHint) {
  try {
    return await notion(path, { method, body });
  } catch (err) {
    if (touchesHint && err instanceof NotionError && err.status === 400 && err.message?.includes(P.hint)) {
      throw new HttpError(400, `請先在 Notion「轉換紀錄」資料庫新增「${P.hint}」欄位（文字類型）`);
    }
    throw err;
  }
}

// 傳給前端時去除密碼雜湊
export function publicRecord({ hash, pageId, ...rest }) {
  return rest;
}

export async function listAll() {
  const pages = await queryAll(await registryDataSource(), {
    sorts: [{ property: P.created, direction: 'descending' }],
  });
  return pages.map(toRecord);
}

export async function findBySlug(slug) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(slug || ''))) return null;
  const pages = await queryAll(await registryDataSource(), {
    filter: { property: P.slug, rich_text: { equals: slug } },
  });
  return pages[0] ? toRecord(pages[0]) : null;
}

export async function findByDatabaseId(databaseId) {
  const pages = await queryAll(await registryDataSource(), {
    filter: { property: P.databaseId, rich_text: { equals: databaseId } },
  });
  return pages[0] ? toRecord(pages[0]) : null;
}

export async function createRecord({ name, databaseId, hash, hint }) {
  const slug = randomBytes(12).toString('base64url');
  const properties = {
    [P.name]: { title: [{ type: 'text', text: { content: name } }] },
    [P.slug]: text(slug),
    [P.databaseId]: text(databaseId),
    [P.hash]: text(hash),
    [P.enabled]: { checkbox: true },
  };
  // 沒填提示就不送這個欄位，尚未新增欄位的轉換紀錄也能照常建立
  if (hint) properties[P.hint] = text(hint);
  await writeRegistry(
    '/pages',
    'POST',
    { parent: { type: 'data_source_id', data_source_id: await registryDataSource() }, properties },
    !!hint,
  );
  return slug;
}

// Notion 資料庫改名後，同步更新轉換紀錄的名稱（登入畫面與管理頁使用）
export async function syncName(record, title) {
  if (!title || title === record.name) return;
  await updateRecord(record.pageId, { name: title });
  record.name = title;
}

// hint 傳空字串代表清除提示；undefined 代表不變
export async function updateRecord(pageId, { name, hash, hint, enabled }) {
  const properties = {};
  if (name) properties[P.name] = { title: [{ type: 'text', text: { content: name } }] };
  if (hash) properties[P.hash] = text(hash);
  if (typeof hint === 'string') properties[P.hint] = text(hint);
  if (typeof enabled === 'boolean') properties[P.enabled] = { checkbox: enabled };
  await writeRegistry(`/pages/${pageId}`, 'PATCH', { properties }, typeof hint === 'string');
}
