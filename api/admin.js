// 轉換器與清單管理（僅擁有者）
import { adminLogin, adminLogout, hashPassword, isAdmin, requireAdmin, validatePassword } from './_lib/auth.js';
import { getQuery, handler, HttpError, readJson, sendJson } from './_lib/http.js';
import { extractNotionId, notion, plainText, queryAll, resolveDatabase } from './_lib/notion.js';
import { createRecord, findByDatabaseId, findBySlug, listAll, publicRecord, updateRecord } from './_lib/registry.js';
import { validateSchema } from './_lib/template.js';

async function inspect(url) {
  const id = extractNotionId(url);
  if (!id) throw new HttpError(400, '網址中找不到 Notion ID，請貼上資料庫的完整網址');

  const db = await resolveDatabase(id);
  const dataSourceId = db?.data_sources?.[0]?.id;
  if (!dataSourceId) {
    throw new HttpError(404, '找不到資料庫。請確認網址正確，且該頁面的「⋯ → Connections」已加入 ShoppingList Integration');
  }
  const ds = await notion(`/data_sources/${dataSourceId}`);
  const { errors, warnings } = validateSchema(ds.properties);
  const items = errors.length ? [] : await queryAll(dataSourceId);
  const existing = await findByDatabaseId(db.id);

  return {
    databaseId: db.id,
    title: plainText(db.title) || '未命名清單',
    itemCount: items.length,
    errors,
    warnings,
    existing: existing ? publicRecord(existing) : null,
  };
}

export default handler(async (req, res) => {
  const action = getQuery(req).get('action');

  if (req.method === 'POST' && action === 'login') {
    const { password } = await readJson(req);
    await adminLogin(req, res, String(password ?? ''));
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && action === 'logout') {
    adminLogout(req, res);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'GET' && action === 'session') {
    return sendJson(res, 200, { admin: isAdmin(req) });
  }

  requireAdmin(req);

  if (req.method === 'GET' && action === 'lists') {
    const records = await listAll();
    return sendJson(res, 200, { lists: records.map(publicRecord) });
  }

  if (req.method === 'POST' && action === 'inspect') {
    const { url } = await readJson(req);
    return sendJson(res, 200, await inspect(url));
  }

  if (req.method === 'POST' && action === 'create') {
    const { url, password } = await readJson(req);
    validatePassword(password);
    const info = await inspect(url);
    if (info.errors.length) throw new HttpError(422, '這個資料庫不符合購物清單模板', { errors: info.errors });
    if (info.existing) {
      throw new HttpError(409, '這個資料庫已經轉換過，可在下方清單中修改密碼', { existing: info.existing });
    }
    const slug = await createRecord({
      name: info.title,
      databaseId: info.databaseId,
      hash: await hashPassword(password),
    });
    return sendJson(res, 201, { slug, name: info.title });
  }

  if (req.method === 'POST' && action === 'update') {
    const { slug, password, enabled } = await readJson(req);
    const record = await findBySlug(slug);
    if (!record) throw new HttpError(404, '找不到這個清單');
    if (password !== undefined) validatePassword(password);
    await updateRecord(record.pageId, {
      hash: password !== undefined ? await hashPassword(password) : undefined,
      enabled: typeof enabled === 'boolean' ? enabled : undefined,
    });
    return sendJson(res, 200, { ok: true });
  }

  throw new HttpError(404, '不支援的操作');
});
