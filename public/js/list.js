import { api, el, fill, storage, toast, yen } from './common.js';

const slug = location.pathname.split('/').filter(Boolean)[1] ?? '';
const $ = (id) => document.getElementById(id);
const PRIORITY_RANK = { 高: 3, 中: 2, 低: 1 };
const FILTER_KEYS = ['category', 'tags', 'people', 'priority'];
const SORTS = {
  priority: '需要程度（高→低）',
  'price-asc': '預估單價（低→高）',
  'price-desc': '預估單價（高→低）',
  name: '商品名稱',
};

const state = {
  name: '',
  items: [],
  options: { category: [], tags: [], people: [], priority: [] },
  view: 'todo',
  query: '',
  sort: 'priority',
  filters: Object.fromEntries(FILTER_KEYS.map((k) => [k, new Set()])),
  expanded: new Set(),
  drafts: new Map(), // 尚未儲存的評分
  inflight: new Map(), // 每個商品的寫入依序送出
};

// ---- 偏好設定（只存 UI 狀態，不存商品資料） ----

const prefsKey = `sl_prefs_${slug}`;

function loadPrefs() {
  const p = storage.get(prefsKey, {});
  if (['todo', 'done', 'all'].includes(p.view)) state.view = p.view;
  if (SORTS[p.sort]) state.sort = p.sort;
  for (const key of FILTER_KEYS) state.filters[key] = new Set(p.filters?.[key] ?? []);
}

function savePrefs() {
  storage.set(prefsKey, {
    view: state.view,
    sort: state.sort,
    filters: Object.fromEntries(FILTER_KEYS.map((k) => [k, [...state.filters[k]]])),
  });
}

// ---- 畫面切換 ----

function show(id) {
  for (const section of ['loading', 'fatal', 'login', 'main']) $(section).hidden = section !== id;
}

function showFatal(message) {
  $('fatal-message').textContent = message;
  show('fatal');
}

function showLogin(name) {
  if (name) {
    $('login-title').textContent = name;
    document.title = name;
  }
  show('login');
  $('login-password').focus();
}

// ---- 資料 ----

async function loadItems({ quiet = false } = {}) {
  if (!quiet) show('loading');
  $('refresh').classList.add('spinning');
  try {
    const data = await api(`/api/list?action=items&slug=${encodeURIComponent(slug)}`);
    state.name = data.name;
    state.items = data.items;
    state.options = data.options;
    // 移除 Notion 中已不存在的選項，避免篩選卡住
    for (const key of FILTER_KEYS) {
      const valid = new Set(state.options[key].map((o) => o.name));
      state.filters[key] = new Set([...state.filters[key]].filter((v) => valid.has(v)));
    }
    document.title = state.name;
    $('title').textContent = state.name;
    show('main');
    render();
    if (quiet) toast('已同步 Notion 最新資料');
  } catch (err) {
    if (err.status === 401) return showLogin(state.name);
    if (quiet) toast(err.message);
    else showFatal(err.message);
  } finally {
    $('refresh').classList.remove('spinning');
  }
}

function updateItem(item, changes) {
  const run = (state.inflight.get(item.id) ?? Promise.resolve()).then(() =>
    api('/api/list?action=update', { method: 'POST', body: { slug, pageId: item.id, ...changes } }),
  );
  state.inflight.set(item.id, run.catch(() => {}));
  return run;
}

async function setPurchased(item, purchased) {
  const previous = item.purchased;
  if (previous === purchased) return;
  item.purchased = purchased;
  render();
  const shortName = item.name.length > 18 ? `${item.name.slice(0, 18)}…` : item.name;
  toast(purchased ? `✓ 已購買：${shortName}` : `已改回未購買：${shortName}`, {
    actionLabel: '復原',
    onAction: () => setPurchased(item, previous),
  });
  try {
    const { item: fresh } = await updateItem(item, { purchased });
    if (item.purchased === fresh.purchased) item.status = fresh.status;
  } catch (err) {
    if (item.purchased === purchased) {
      item.purchased = previous;
      render();
    }
    if (err.status === 401) return showLogin(state.name);
    toast(`同步失敗，已還原：${err.message}`);
  }
}

async function saveRating(item, button) {
  const rating = (state.drafts.get(item.id) ?? item.rating).trim();
  button.disabled = true;
  button.textContent = '儲存中…';
  try {
    const { item: fresh } = await updateItem(item, { rating });
    item.rating = fresh.rating;
    state.drafts.delete(item.id);
    toast('評分已儲存到 Notion');
  } catch (err) {
    if (err.status === 401) return showLogin(state.name);
    toast(`儲存失敗：${err.message}`);
  }
  render();
}

// ---- 篩選 / 排序 / 搜尋 ----

function matches(item) {
  if (state.view === 'todo' && item.purchased) return false;
  if (state.view === 'done' && !item.purchased) return false;
  const f = state.filters;
  if (f.category.size && !f.category.has(item.category)) return false;
  if (f.priority.size && !f.priority.has(item.priority)) return false;
  if (f.tags.size && !item.tags.some((t) => f.tags.has(t))) return false;
  if (f.people.size && !item.people.some((p) => f.people.has(p))) return false;
  const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const haystack = [item.name, item.shop, item.category, ...item.tags, ...item.note.map((n) => n.text)]
      .join(' ')
      .toLowerCase();
    if (!words.every((w) => haystack.includes(w))) return false;
  }
  return true;
}

const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hant');
const priceOf = (item, fallback) => item.price ?? fallback;

function sortItems(items) {
  const sorted = [...items];
  switch (state.sort) {
    case 'price-asc':
      return sorted.sort((a, b) => priceOf(a, Infinity) - priceOf(b, Infinity) || byName(a, b));
    case 'price-desc':
      return sorted.sort((a, b) => priceOf(b, -Infinity) - priceOf(a, -Infinity) || byName(a, b));
    case 'name':
      return sorted.sort(byName);
    default:
      return sorted.sort(
        (a, b) => (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0) || byName(a, b),
      );
  }
}

function activeFilterCount() {
  return FILTER_KEYS.filter((k) => k !== 'category').reduce((n, k) => n + state.filters[k].size, 0);
}

// ---- 繪製 ----

function colorOf(key, name) {
  return state.options[key].find((o) => o.name === name)?.color ?? 'default';
}

function chip(label, color, extraClass = '') {
  return el('span', { class: `chip c-${color} ${extraClass}`, text: label });
}

function toggleChip({ label, color, pressed, onClick }) {
  return el('button', {
    type: 'button',
    class: `chip chip-toggle c-${color ?? 'default'}`,
    'aria-pressed': String(pressed),
    text: label,
    onClick,
  });
}

function render() {
  const total = state.items.length;
  const done = state.items.filter((i) => i.purchased).length;
  $('progress').textContent = `已購買 ${done} / ${total}`;

  for (const btn of document.querySelectorAll('.segmented button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.view === state.view));
  }

  renderCategoryChips();
  renderFilterPanel();

  const badge = $('filter-badge');
  const count = activeFilterCount();
  badge.hidden = !count;
  badge.textContent = count;

  const visible = sortItems(state.items.filter((i) => matches(i)));
  const sum = visible.reduce((s, i) => s + (i.total ?? 0), 0);
  $('summary').textContent = `${visible.length} 項${sum ? ` · 預估合計 ${yen(sum)}` : ''}`;

  $('items').replaceChildren(...visible.map(renderItem));

  const empty = $('empty');
  empty.hidden = visible.length > 0;
  if (!visible.length) {
    const narrowed = state.query || count || state.filters.category.size;
    if (narrowed) empty.textContent = '沒有符合條件的商品';
    else if (!total) empty.textContent = '清單是空的';
    else if (state.view === 'todo') empty.textContent = '🎉 全部都買齊了！';
    else empty.textContent = '還沒有已購買的商品';
  }
}

function renderCategoryChips() {
  const selected = state.filters.category;
  const all = toggleChip({
    label: '全部',
    pressed: selected.size === 0,
    onClick: () => {
      selected.clear();
      savePrefs();
      render();
    },
  });
  const chips = state.options.category.map((o) =>
    toggleChip({
      label: o.name,
      color: o.color,
      pressed: selected.has(o.name),
      onClick: () => {
        // 種類用單選，符合在賣場「只看某一類」的直覺
        const only = selected.size === 1 && selected.has(o.name);
        selected.clear();
        if (!only) selected.add(o.name);
        savePrefs();
        render();
      },
    }),
  );
  $('category-chips').replaceChildren(all, ...chips);
}

function renderFilterPanel() {
  const panel = $('filter-panel');
  if (panel.hidden) return;

  const group = (key, title) => {
    if (!state.options[key].length) return null;
    const set = state.filters[key];
    return el(
      'fieldset',
      { class: 'filter-group' },
      el('legend', { text: title }),
      el(
        'div',
        { class: 'chip-wrap' },
        state.options[key].map((o) =>
          toggleChip({
            label: o.name,
            color: o.color,
            pressed: set.has(o.name),
            onClick: () => {
              set.has(o.name) ? set.delete(o.name) : set.add(o.name);
              savePrefs();
              render();
            },
          }),
        ),
      ),
    );
  };

  const sortSelect = el(
    'select',
    {
      id: 'sort',
      onChange: (e) => {
        state.sort = e.target.value;
        savePrefs();
        render();
      },
    },
    Object.entries(SORTS).map(([value, label]) => el('option', { value, text: label, selected: value === state.sort })),
  );

  fill(panel, 
    el('label', { class: 'filter-group sort-group' }, el('span', { class: 'legend', text: '排序' }), sortSelect),
    group('tags', '購買地點（Tag）'),
    group('people', '需要的人'),
    group('priority', '需要程度'),
    el(
      'div',
      { class: 'filter-actions' },
      el('button', {
        type: 'button',
        class: 'btn btn-ghost',
        text: '清除篩選',
        onClick: () => {
          for (const key of FILTER_KEYS) state.filters[key].clear();
          savePrefs();
          render();
        },
      }),
      el('button', { type: 'button', class: 'btn btn-primary', text: '完成', onClick: () => toggleFilterPanel(false) }),
    ),
  );
}

function renderItem(item) {
  const expanded = state.expanded.has(item.id);
  const thumb = item.images[0]
    ? el('img', { class: 'thumb', src: item.images[0], alt: '', loading: 'lazy', onError: (e) => e.target.replaceWith(placeholder()) })
    : placeholder();

  const meta = el(
    'div',
    { class: 'item-meta' },
    item.priority && chip(item.priority, colorOf('priority', item.priority), 'chip-sm'),
    item.category && chip(item.category, colorOf('category', item.category), 'chip-sm'),
    item.tags.map((t) => chip(t, colorOf('tags', t), 'chip-sm')),
  );

  const facts = [
    item.qty ? `× ${item.qty}` : null,
    item.price != null ? yen(item.price) : null,
    item.people.length ? `👤 ${item.people.join('、')}` : null,
  ].filter(Boolean);

  const summary = el(
    'button',
    {
      type: 'button',
      class: 'item-summary',
      'aria-expanded': String(expanded),
      onClick: () => {
        expanded ? state.expanded.delete(item.id) : state.expanded.add(item.id);
        render();
      },
    },
    thumb,
    el(
      'div',
      { class: 'item-body' },
      el('p', { class: 'item-name', text: item.name }),
      meta,
      facts.length ? el('p', { class: 'item-facts muted', text: facts.join(' · ') }) : null,
      item.rating ? el('p', { class: 'item-rating-preview', text: `💬 ${item.rating}` }) : null,
    ),
  );

  const check = el(
    'button',
    {
      type: 'button',
      class: 'check',
      'aria-pressed': String(item.purchased),
      'aria-label': item.purchased ? '改回未購買' : '標記為已購買',
      onClick: () => setPurchased(item, !item.purchased),
    },
    el('span', { 'aria-hidden': 'true', text: '✓' }),
  );

  return el(
    'li',
    { class: `item${item.purchased ? ' is-done' : ''}${expanded ? ' is-open' : ''}` },
    el('div', { class: 'item-row' }, summary, check),
    expanded ? renderDetail(item) : null,
  );
}

function placeholder() {
  return el('div', { class: 'thumb thumb-empty', 'aria-hidden': 'true', text: '🛍️' });
}

function renderDetail(item) {
  const rows = [];
  if (item.images.length) {
    rows.push(
      el(
        'div',
        { class: 'gallery' },
        item.images.map((src) =>
          el('a', { href: src, target: '_blank', rel: 'noopener noreferrer' }, el('img', { src, alt: '', loading: 'lazy' })),
        ),
      ),
    );
  }
  const field = (label, content) => el('div', { class: 'field' }, el('span', { class: 'field-label', text: label }), content);
  if (item.shop) rows.push(field('商店', el('span', { text: item.shop })));
  if (item.total != null) rows.push(field('預估總價', el('span', { text: yen(item.total) })));
  if (item.note.length) {
    rows.push(
      field('備註', el('p', { class: 'note' }, item.note.map((n) => (n.bold ? el('strong', { text: n.text }) : n.text)))),
    );
  }
  if (item.source) {
    rows.push(field('推薦來源', el('a', { href: item.source, target: '_blank', rel: 'noopener noreferrer', text: '開啟連結 ↗' })));
  }

  const draft = state.drafts.get(item.id) ?? item.rating;
  const save = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: '儲存評分', disabled: draft === item.rating });
  const textarea = el('textarea', {
    rows: 3,
    maxlength: 2000,
    placeholder: '使用 / 食用心得、評分、是否回購…',
    onInput: (e) => {
      state.drafts.set(item.id, e.target.value);
      save.disabled = e.target.value === item.rating;
    },
  });
  textarea.value = draft;
  save.addEventListener('click', () => saveRating(item, save));
  rows.push(el('div', { class: 'rating' }, el('label', { class: 'field-label', text: '評分 / 心得' }), textarea, save));

  return el('div', { class: 'item-detail' }, rows);
}

function toggleFilterPanel(open = $('filter-panel').hidden) {
  $('filter-panel').hidden = !open;
  $('filter-toggle').setAttribute('aria-expanded', String(open));
  render();
}

// ---- 事件 ----

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button');
  button.disabled = true;
  $('login-error').textContent = '';
  try {
    await api('/api/list?action=login', { method: 'POST', body: { slug, password: $('login-password').value } });
    $('login-password').value = '';
    await loadItems();
  } catch (err) {
    $('login-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

$('refresh').addEventListener('click', () => loadItems({ quiet: true }));
$('filter-toggle').addEventListener('click', () => toggleFilterPanel());

let searchTimer;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    render();
  }, 120);
});

for (const btn of document.querySelectorAll('.segmented button')) {
  btn.addEventListener('click', () => {
    state.view = btn.dataset.view;
    savePrefs();
    render();
  });
}

// ---- 啟動 ----

async function init() {
  if (!slug) return showFatal('網址不正確');
  loadPrefs();
  try {
    const info = await api(`/api/list?action=info&slug=${encodeURIComponent(slug)}`);
    state.name = info.name;
    document.title = info.name;
    if (info.authorized) await loadItems();
    else showLogin(info.name);
  } catch (err) {
    showFatal(err.message);
  }
}

init();
