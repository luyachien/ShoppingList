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

// 網站只允許寫入「狀態」與「評分」
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
