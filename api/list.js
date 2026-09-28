// 清單頁（旅伴與擁有者）：頁面、安裝設定、登入、讀取商品、新增商品、更新狀態 / 評分、附加照片
import { readFile } from 'node:fs/promises';
import { failDelay, hasListAccess, listLogin, verifyPassword } from './_lib/auth.js';
import { getQuery, handler, HttpError, readBinary, readJson, sendJson } from './_lib/http.js';
import { formatId, getDatabase, notion, plainText, queryAll, uploadFile } from './_lib/notion.js';
import { findBySlug, syncName } from './_lib/registry.js';
import {
  RATING_MAX_LENGTH,
  schemaOptions,
  supportsPhotos,
  toAppendPhotoProperties,
  toCreateProperties,
  toItem,
  toUpdateProperties,
} from './_lib/template.js';

const DEFAULT_TITLE = '旅行購物清單';
// Vercel 請求上限 4.5MB；前端會先壓縮，一般照片約 1MB 以內
const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };

async function getActiveRecord(slug) {
  const record = await findBySlug(slug);
  if (!record || !record.enabled) throw new HttpError(404, '這個清單不存在或已停用');
  return record;
}

function requireAccess(req, record) {
  if (!hasListAccess(req, record)) throw new HttpError(401, '請輸入清單密碼');
}

// 確認商品屬於這個清單，避免用別的清單的密碼修改其他資料庫
async function getListPage(pageId, dataSourceId) {
  const id = formatId(pageId);
  if (!id) throw new HttpError(400, '商品 ID 錯誤');
  const page = await notion(`/pages/${id}`);
  if (page.parent?.data_source_id !== dataSourceId || page.in_trash || page.archived) {
    throw new HttpError(404, '找不到這個商品');
  }
  return page;
}

function origin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 回傳清單頁 HTML，並填入清單名稱與預覽圖（LINE、Messenger 等預覽不會執行 JavaScript）
async function sendPage(req, res, slug) {
  const record = await findBySlug(slug).catch(() => null);
  const title = record?.enabled ? record.name : DEFAULT_TITLE;
  const base = origin(req);
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${DEFAULT_TITLE}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="點開查看要買的商品，勾選已購買並記錄心得">`,
    `<meta property="og:image" content="${base}/og-image.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<link rel="manifest" href="/api/list?action=manifest&amp;slug=${encodeURIComponent(slug)}">`,
  ].join('\n  ');
  const html = await readFile(new URL('../public/list.html', import.meta.url), 'utf8');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // 同一個清單的頁面內容幾乎不變，讓 CDN 快取以加快開啟速度
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
  res.end(html.replace('<title>購物清單</title>', tags));
}

// 安裝到主畫面用的 Web App Manifest；從該清單開啟，名稱使用清單標題
async function sendManifest(res, slug) {
  const record = await findBySlug(slug).catch(() => null);
  const name = record?.enabled ? record.name : DEFAULT_TITLE;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  res.end(
    JSON.stringify({
      id: '/',
      name,
      short_name: name.length > 12 ? '購物清單' : name,
      start_url: `/l/${slug}`,
      scope: '/',
      display: 'standalone',
      background_color: '#f7f6f3',
      theme_color: '#2383e2',
      lang: 'zh-Hant',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }),
  );
}

export default handler(async (req, res) => {
  const query = getQuery(req);
  const action = query.get('action');

  if (req.method === 'GET' && action === 'page') return sendPage(req, res, query.get('slug'));
  if (req.method === 'GET' && action === 'manifest') return sendManifest(res, query.get('slug'));

  // 照片是原始二進位內容，slug 與商品 ID 放在網址參數
  const body = req.method === 'POST' && action !== 'photo' ? await readJson(req) : {};
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
  // 每次都向 Notion 取得資料庫，才能拿到最新標題
  const db = await getDatabase(record.databaseId);
  const dataSourceId = db.data_sources?.[0]?.id;
  if (!dataSourceId) throw new HttpError(404, '找不到這個清單的資料庫');

  if (req.method === 'GET' && action === 'items') {
    const [ds, pages] = await Promise.all([notion(`/data_sources/${dataSourceId}`), queryAll(dataSourceId)]);
    await syncName(record, plainText(db.title).trim()).catch((err) => console.error('syncName failed', err.code));
    return sendJson(res, 200, {
      name: record.name,
      // 在 Notion 開啟用；能否查看由 Notion 權限決定，網站無法得知
      notionUrl: db.url ?? null,
      options: schemaOptions(ds.properties),
      canAddPhotos: supportsPhotos(ds.properties),
      items: pages.map(toItem),
    });
  }

  if (req.method === 'POST' && action === 'create') {
    const ds = await notion(`/data_sources/${dataSourceId}`);
    const { properties, errors } = toCreateProperties(body.item ?? {}, ds.properties);
    if (errors.length) throw new HttpError(400, errors.join('；'));
    const page = await notion('/pages', {
      method: 'POST',
      body: { parent: { type: 'data_source_id', data_source_id: dataSourceId }, properties },
    });
    return sendJson(res, 201, { item: toItem(page) });
  }

  if (req.method === 'POST' && action === 'update') {
    if (typeof body.rating === 'string' && body.rating.length > RATING_MAX_LENGTH) {
      throw new HttpError(400, `評分最多 ${RATING_MAX_LENGTH} 字`);
    }
    const properties = toUpdateProperties({ purchased: body.purchased, rating: body.rating });
    if (!Object.keys(properties).length) throw new HttpError(400, '沒有要更新的內容');

    const page = await getListPage(body.pageId, dataSourceId);
    const updated = await notion(`/pages/${page.id}`, { method: 'PATCH', body: { properties } });
    return sendJson(res, 200, { item: toItem(updated) });
  }

  // 一次一張，前端依序上傳；每張都重新讀取頁面，才能保留剛附加的照片
  if (req.method === 'POST' && action === 'photo') {
    const type = query.get('type');
    if (!PHOTO_TYPES[type]) throw new HttpError(415, '只支援 JPEG、PNG、WebP、HEIC 照片');
    const page = await getListPage(query.get('pageId'), dataSourceId);
    if (!supportsPhotos(page.properties)) throw new HttpError(400, '這個清單沒有「檔案和媒體」欄位');
    const buffer = await readBinary(req, PHOTO_MAX_BYTES);
    if (!buffer.length) throw new HttpError(400, '沒有收到照片');
    const filename = `photo-${Date.now()}.${PHOTO_TYPES[type]}`;
    const uploadId = await uploadFile(buffer, type, filename);
    const updated = await notion(`/pages/${page.id}`, {
      method: 'PATCH',
      body: { properties: toAppendPhotoProperties(page, uploadId, filename) },
    });
    return sendJson(res, 200, { item: toItem(updated) });
  }

  throw new HttpError(404, '不支援的操作');
});
