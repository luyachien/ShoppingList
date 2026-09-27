// 「轉換紀錄」Database 的讀寫；每筆紀錄 = 一個分享出去的清單
import { randomBytes } from 'node:crypto';
import { getDataSourceId, notion, plainText, queryAll } from './notion.js';

const P = {
  name: '名稱',
  slug: 'slug',
  databaseId: 'Database ID',
  hash: '密碼雜湊',
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
    enabled: !!p[P.enabled]?.checkbox,
    createdTime: p[P.created]?.created_time ?? page.created_time,
  };
}

const text = (content) => ({ rich_text: [{ type: 'text', text: { content } }] });

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

export async function createRecord({ name, databaseId, hash }) {
  const slug = randomBytes(12).toString('base64url');
  await notion('/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: await registryDataSource() },
      properties: {
        [P.name]: { title: [{ type: 'text', text: { content: name } }] },
        [P.slug]: text(slug),
        [P.databaseId]: text(databaseId),
        [P.hash]: text(hash),
        [P.enabled]: { checkbox: true },
      },
    },
  });
  return slug;
}

// Notion 資料庫改名後，同步更新轉換紀錄的名稱（登入畫面與管理頁使用）
export async function syncName(record, title) {
  if (!title || title === record.name) return;
  await updateRecord(record.pageId, { name: title });
  record.name = title;
}

export async function updateRecord(pageId, { name, hash, enabled }) {
  const properties = {};
  if (name) properties[P.name] = { title: [{ type: 'text', text: { content: name } }] };
  if (hash) properties[P.hash] = text(hash);
  if (typeof enabled === 'boolean') properties[P.enabled] = { checkbox: enabled };
  await notion(`/pages/${pageId}`, { method: 'PATCH', body: { properties } });
}
