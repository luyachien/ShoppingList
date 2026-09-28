// 購物清單模板的唯一定義處：Notion 欄位名稱只能出現在這個檔案
import { plainText } from './notion.js';

export const STATUS_TODO = '未購買';
export const STATUS_DONE = '已購買';
export const RATING_MAX_LENGTH = 2000;

const FIELDS = {
  name: { prop: '商品名稱', type: 'title', required: true },
  status: { prop: '狀態', type: 'status', required: true },
  rating: { prop: '評分', type: 'rich_text', required: true },
  category: { prop: '種類', type: 'select', required: true },
  tags: { prop: 'Tag', type: 'multi_select' },
  priority: { prop: '需要程度', type: 'select' },
  people: { prop: '需要的人', type: 'multi_select' },
  qty: { prop: '最少購買數量', type: 'number' },
  price: { prop: '預估單價(含稅)', type: 'number' },
  total: { prop: '預估總價(含稅)', type: 'formula' },
  shop: { prop: '商店', type: 'rich_text' },
  note: { prop: '備註', type: 'rich_text' },
  source: { prop: '商品推薦來源', type: 'url' },
  images: { prop: '檔案和媒體', type: 'files' },
};

// 回傳 { errors: [必要欄位問題], warnings: [選用欄位問題] }
export function validateSchema(properties) {
  const errors = [];
  const warnings = [];
  for (const { prop, type, required } of Object.values(FIELDS)) {
    const actual = properties[prop];
    let problem = null;
    if (!actual) problem = `缺少欄位「${prop}」`;
    else if (actual.type !== type) problem = `欄位「${prop}」型別應為 ${type}，目前是 ${actual.type}`;
    if (problem) (required ? errors : warnings).push(problem);
  }
  const statusOptions = properties[FIELDS.status.prop]?.status?.options?.map((o) => o.name) ?? [];
  for (const name of [STATUS_TODO, STATUS_DONE]) {
    if (properties[FIELDS.status.prop]?.type === 'status' && !statusOptions.includes(name)) {
      errors.push(`「${FIELDS.status.prop}」欄位缺少選項「${name}」`);
    }
  }
  return { errors, warnings };
}

// 篩選用的選項清單，依 Notion 中的排列順序與顏色
export function schemaOptions(properties) {
  const pick = (key) => {
    const p = properties[FIELDS[key].prop];
    if (!p || p.type !== FIELDS[key].type) return [];
    return (p[p.type]?.options ?? []).map((o) => ({ name: o.name, color: o.color }));
  };
  return {
    category: pick('category'),
    tags: pick('tags'),
    people: pick('people'),
    priority: pick('priority'),
  };
}

export function toItem(page) {
  const props = page.properties;
  const get = (key) => {
    const p = props[FIELDS[key].prop];
    return p && p.type === FIELDS[key].type ? p[p.type] : undefined;
  };
  const formula = get('total');
  const status = get('status')?.name ?? STATUS_TODO;
  const fullName = plainText(get('name')).trim() || '（未命名）';
  // 模板慣例：商品名稱開頭的【】為品牌
  const brandMatch = fullName.match(/^【([^】]+)】\s*(.+)$/s);
  return {
    id: page.id,
    name: brandMatch ? brandMatch[2] : fullName,
    brand: brandMatch ? brandMatch[1].trim() : null,
    status,
    purchased: status === STATUS_DONE,
    rating: plainText(get('rating')),
    category: get('category')?.name ?? null,
    tags: (get('tags') ?? []).map((o) => o.name),
    priority: get('priority')?.name ?? null,
    people: (get('people') ?? []).map((o) => o.name),
    qty: get('qty') ?? null,
    price: get('price') ?? null,
    total: formula?.type === 'number' ? formula.number : null,
    shop: plainText(get('shop')),
    // 保留粗體與超連結，備註常用來標示重點與地圖連結
    note: (get('note') ?? []).map((t) => ({
      text: t.plain_text,
      bold: !!t.annotations?.bold,
      href: safeUrl(t.href),
    })),
    source: safeUrl(get('source')),
    images: (get('images') ?? []).map((f) => f.file?.url ?? f.external?.url).filter(Boolean),
  };
}

const LIMITS = { brand: 60, name: 200, shop: 200, note: 2000, source: 1000, qty: 999, price: 10_000_000 };

// 驗證網站送來的新商品，轉成 Notion properties；只使用 schema 中存在的欄位與選項
export function toCreateProperties(input, schema) {
  const errors = [];
  const properties = {};
  const has = (key) => schema[FIELDS[key].prop]?.type === FIELDS[key].type;
  const optionNames = (key) => (has(key) ? schema[FIELDS[key].prop][FIELDS[key].type].options.map((o) => o.name) : []);
  const str = (value, key, label) => {
    const v = typeof value === 'string' ? value.trim() : '';
    if (v.length > LIMITS[key]) errors.push(`${label}最多 ${LIMITS[key]} 字`);
    return v;
  };
  const richText = (content) => ({ rich_text: content ? [{ type: 'text', text: { content } }] : [] });

  const brand = str(input.brand, 'brand', '品牌').replace(/[【】]/g, '');
  const name = str(input.name, 'name', '商品名稱');
  if (!name) errors.push('請輸入商品名稱');
  const fullName = brand ? `【${brand}】${name}` : name;
  properties[FIELDS.name.prop] = { title: [{ type: 'text', text: { content: fullName } }] };
  properties[FIELDS.status.prop] = { status: { name: STATUS_TODO } };

  for (const [key, label] of [['category', '種類'], ['priority', '需要程度']]) {
    const v = typeof input[key] === 'string' ? input[key] : '';
    if (!v || !has(key)) continue;
    if (!optionNames(key).includes(v)) errors.push(`${label}「${v}」不在選項中`);
    else properties[FIELDS[key].prop] = { select: { name: v } };
  }

  for (const [key, label] of [['tags', 'Tag'], ['people', '需要的人']]) {
    const values = Array.isArray(input[key]) ? [...new Set(input[key].map(String))] : [];
    if (!values.length || !has(key)) continue;
    const invalid = values.filter((v) => !optionNames(key).includes(v));
    if (invalid.length) errors.push(`${label}「${invalid.join('、')}」不在選項中`);
    else properties[FIELDS[key].prop] = { multi_select: values.map((name) => ({ name })) };
  }

  for (const [key, label, integer] of [['qty', '數量', true], ['price', '預估單價', false]]) {
    const raw = input[key];
    if (raw === null || raw === undefined || raw === '' || !has(key)) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > LIMITS[key] || (integer && !Number.isInteger(n))) {
      errors.push(`${label}格式錯誤`);
    } else {
      properties[FIELDS[key].prop] = { number: n };
    }
  }

  const shop = str(input.shop, 'shop', '商店');
  if (shop && has('shop')) properties[FIELDS.shop.prop] = richText(shop);
  const note = str(input.note, 'note', '備註');
  if (note && has('note')) properties[FIELDS.note.prop] = richText(note);
  const source = str(input.source, 'source', '推薦來源');
  if (source && has('source')) {
    if (!safeUrl(source)) errors.push('推薦來源必須是 http:// 或 https:// 開頭的網址');
    else properties[FIELDS.source.prop] = { url: safeUrl(source) };
  }

  return { properties, errors };
}

// 只允許 http(s) 連結，避免 javascript: 等危險網址被放進 <a href>
function safeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

// 資料庫有「檔案和媒體」欄位才能從網站加照片
export function supportsPhotos(properties) {
  return properties[FIELDS.images.prop]?.type === FIELDS.images.type;
}

// files 欄位更新會整個取代，所以既有的檔案要一起送回，新照片接在最後
export function toAppendPhotoProperties(page, uploadId, filename) {
  const existing = (page.properties[FIELDS.images.prop]?.files ?? []).map((f) =>
    f.type === 'external'
      ? { name: f.name, type: 'external', external: { url: f.external.url } }
      : { name: f.name, type: 'file', file: { url: f.file.url } },
  );
  return {
    [FIELDS.images.prop]: {
      files: [...existing, { name: filename, type: 'file_upload', file_upload: { id: uploadId } }],
    },
  };
}

// 既有商品只允許寫入「狀態」與「評分」（照片另由 toAppendPhotoProperties 附加）
export function toUpdateProperties({ purchased, rating }) {
  const properties = {};
  if (typeof purchased === 'boolean') {
    properties[FIELDS.status.prop] = { status: { name: purchased ? STATUS_DONE : STATUS_TODO } };
  }
  if (typeof rating === 'string') {
    properties[FIELDS.rating.prop] = {
      rich_text: rating ? [{ type: 'text', text: { content: rating } }] : [],
    };
  }
  return properties;
}
