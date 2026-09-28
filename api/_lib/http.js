import { NotionError } from './notion.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

export function getQuery(req) {
  return new URL(req.url, 'http://localhost').searchParams;
}

// Vercel 會預先解析 req.body；本機開發伺服器則需要自己讀取串流
export async function readJson(req) {
  if (req.body !== undefined) {
    return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {};
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new HttpError(413, '資料太大');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, '資料格式錯誤');
  }
}

// 讀取照片的原始內容；Vercel 會把 application/octet-stream 預先解析成 Buffer
export async function readBinary(req, maxBytes) {
  const tooLarge = () => new HttpError(413, `照片太大（上限 ${Math.floor(maxBytes / 1024 / 1024)}MB）`);
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) throw tooLarge();
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, ...err.extra });
      if (err instanceof NotionError) {
        console.error('Notion error', err.status, err.code);
        if (err.status === 429) return sendJson(res, 503, { error: 'Notion 忙碌中，請稍後再試' });
        return sendJson(res, 502, { error: 'Notion 連線失敗，請稍後再試' });
      }
      console.error('Unexpected error', err?.message);
      sendJson(res, 500, { error: '伺服器發生錯誤' });
    }
  };
}
