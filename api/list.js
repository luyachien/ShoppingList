// 清單頁（旅伴與擁有者）：登入、讀取商品、更新狀態 / 評分
import { failDelay, hasListAccess, listLogin, verifyPassword } from './_lib/auth.js';
import { getQuery, handler, HttpError, readJson, sendJson } from './_lib/http.js';
import { formatId, getDataSourceId, notion, queryAll } from './_lib/notion.js';
import { findBySlug } from './_lib/registry.js';
import { RATING_MAX_LENGTH, schemaOptions, toItem, toUpdateProperties } from './_lib/template.js';

async function getActiveRecord(slug) {
  const record = await findBySlug(slug);
  if (!record || !record.enabled) throw new HttpError(404, '這個清單不存在或已停用');
  return record;
}

function requireAccess(req, record) {
  if (!hasListAccess(req, record)) throw new HttpError(401, '請輸入清單密碼');
}

export default handler(async (req, res) => {
  const query = getQuery(req);
  const action = query.get('action');
  const body = req.method === 'POST' ? await readJson(req) : {};
  const record = await getActiveRecord(query.get('slug') ?? body.slug);

  if (req.method === 'GET' && action === 'info') {
    return sendJson(res, 200, { name: record.name, authorized: hasListAccess(req, record) });
  }

  if (req.method === 'POST' && action === 'login') {
    if (!(await verifyPassword(String(body.password ?? ''), record.hash))) {
      await failDelay();
      throw new HttpError(401, '密碼錯誤');
    }
    listLogin(req, res, record);
    return sendJson(res, 200, { ok: true });
  }

  requireAccess(req, record);
  const dataSourceId = await getDataSourceId(record.databaseId);

  if (req.method === 'GET' && action === 'items') {
    const [ds, pages] = await Promise.all([notion(`/data_sources/${dataSourceId}`), queryAll(dataSourceId)]);
    return sendJson(res, 200, {
      name: record.name,
      options: schemaOptions(ds.properties),
      items: pages.map(toItem),
    });
  }

  if (req.method === 'POST' && action === 'update') {
    const pageId = formatId(body.pageId);
    if (!pageId) throw new HttpError(400, '商品 ID 錯誤');
    if (typeof body.rating === 'string' && body.rating.length > RATING_MAX_LENGTH) {
      throw new HttpError(400, `評分最多 ${RATING_MAX_LENGTH} 字`);
    }
    const properties = toUpdateProperties({ purchased: body.purchased, rating: body.rating });
    if (!Object.keys(properties).length) throw new HttpError(400, '沒有要更新的內容');

    // 確認商品屬於這個清單，避免用別的清單的密碼修改其他資料庫
    const page = await notion(`/pages/${pageId}`);
    if (page.parent?.data_source_id !== dataSourceId || page.in_trash || page.archived) {
      throw new HttpError(404, '找不到這個商品');
    }
    const updated = await notion(`/pages/${pageId}`, { method: 'PATCH', body: { properties } });
    return sendJson(res, 200, { item: toItem(updated) });
  }

  throw new HttpError(404, '不支援的操作');
});
