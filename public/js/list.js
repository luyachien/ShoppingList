import { api, el, fill, initThemeToggles, storage, toast, toggleChip, yen } from './common.js';
import { initAddItem } from './add-item.js';
import { initInstall } from './install.js';
import { initSwitcher, rememberList } from './saved-lists.js';

const slug = location.pathname.split('/').filter(Boolean)[1] ?? '';
const $ = (id) => document.getElementById(id);
const PRIORITY_RANK = { 高: 3, 中: 2, 低: 1 };
const FILTER_KEYS = ['category', 'tags', 'people', 'priority'];
const VIEWS = { todo: '未購買', done: '已購買', all: '全部' };
const SORTS = {
  priority: '需要程度（高→低）',
  'price-asc': '預估單價（低→高）',
  'price-desc': '預估單價（高→低）',
  name: '商品名稱',
  brand: '品牌',
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
    rememberList(slug, state.name);
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
    const haystack = [item.brand, item.name, item.shop, item.category, ...item.tags, ...item.note.map((n) => n.text)]
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
    case 'brand':
      // 沒有品牌的排最後
      return sorted.sort(
        (a, b) => (a.brand ?? '￿').localeCompare(b.brand ?? '￿', 'zh-Hant') || byName(a, b),
      );
    default:
      return sorted.sort(
        (a, b) => (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0) || byName(a, b),
      );
  }
}

function activeFilterCount() {
  return FILTER_KEYS.reduce((n, k) => n + state.filters[k].size, 0);
}

// ---- 繪製 ----

function colorOf(key, name) {
  return state.options[key].find((o) => o.name === name)?.color ?? 'default';
}

function chip(label, color, extraClass = '') {
  return el('span', { class: `chip c-${color} ${extraClass}`, text: label });
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

  const section = (title, ...content) =>
    el('fieldset', { class: 'filter-group' }, el('legend', { text: title }), el('div', { class: 'chip-wrap' }, content));

  const group = (key, title) => {
    if (!state.options[key].length) return null;
    const set = state.filters[key];
    return section(
      title,
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
    );
  };

  const views = section(
    '購買狀態',
    Object.entries(VIEWS).map(([view, label]) =>
      toggleChip({
        label,
        pressed: state.view === view,
        onClick: () => {
          state.view = view;
          savePrefs();
          render();
        },
      }),
    ),
  );

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

  fill(
    panel,
    el('label', { class: 'filter-group sort-group' }, el('span', { class: 'legend', text: '排序' }), sortSelect),
    views,
    group('category', '種類'),
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
  const thumb = item.images.length
    ? el(
        'button',
        { type: 'button', class: 'thumb-btn', 'aria-label': '放大商品圖片', onClick: () => openLightbox(item.images, 0) },
        el('img', { class: 'thumb', src: item.images[0], alt: '', loading: 'lazy', onError: (e) => e.target.replaceWith(placeholder()) }),
      )
    : placeholder();

  const meta = el(
    'div',
    { class: 'item-meta' },
    item.priority && chip(item.priority, colorOf('priority', item.priority), 'chip-sm'),
    item.category && chip(item.category, colorOf('category', item.category), 'chip-sm'),
    item.tags.map((t) => chip(t, colorOf('tags', t), 'chip-sm')),
  );

  const prices = [
    item.qty ? `× ${item.qty}` : null,
    item.price != null ? `單價 ${yen(item.price)}` : null,
    item.total != null ? `總價 ${yen(item.total)}` : null,
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
    item.brand ? el('span', { class: 'item-brand', text: item.brand }) : null,
    el('span', { class: 'item-name', text: item.name }),
    meta,
    prices.length ? el('span', { class: 'item-facts muted', text: prices.join(' · ') }) : null,
    item.people.length ? el('span', { class: 'item-facts muted', text: `👤 ${item.people.join('、')}` }) : null,
    item.rating ? el('span', { class: 'item-rating-preview', text: `💬 ${item.rating}` }) : null,
  );

  const source = item.source
    ? el(
        'a',
        { class: 'side-btn source-btn', href: item.source, target: '_blank', rel: 'noopener noreferrer', 'aria-label': '開啟推薦來源' },
        el('span', { class: 'side-icon', 'aria-hidden': 'true', text: '↗' }),
        el('span', { class: 'side-label', text: '來源' }),
      )
    : null;

  const check = el(
    'button',
    {
      type: 'button',
      class: 'side-btn check',
      'aria-pressed': String(item.purchased),
      'aria-label': item.purchased ? '改回未購買' : '標記為已購買',
      onClick: () => setPurchased(item, !item.purchased),
    },
    el('span', { class: 'check-mark', 'aria-hidden': 'true', text: '✓' }),
  );

  return el(
    'li',
    { class: `item${item.purchased ? ' is-done' : ''}${expanded ? ' is-open' : ''}` },
    el('div', { class: 'item-row' }, thumb, summary, source, check),
    expanded ? renderDetail(item) : null,
  );
}

function placeholder() {
  return el('div', { class: 'thumb thumb-empty', 'aria-hidden': 'true', text: '🛍️' });
}

function noteContent(note) {
  return note.map((n) => {
    const text = n.bold ? el('strong', { text: n.text }) : n.text;
    return n.href ? el('a', { href: n.href, target: '_blank', rel: 'noopener noreferrer' }, text) : text;
  });
}

function renderDetail(item) {
  const rows = [];
  if (item.images.length) {
    rows.push(
      el(
        'div',
        { class: 'gallery' },
        item.images.map((src, i) =>
          el(
            'button',
            { type: 'button', 'aria-label': `放大第 ${i + 1} 張圖片`, onClick: () => openLightbox(item.images, i) },
            el('img', { src, alt: '', loading: 'lazy' }),
          ),
        ),
      ),
    );
  }
  const field = (label, content) => el('div', { class: 'field' }, el('span', { class: 'field-label', text: label }), content);
  if (item.shop) rows.push(field('商店', el('span', { text: item.shop })));
  if (item.price != null || item.total != null) {
    rows.push(
      el(
        'div',
        { class: 'field-pair' },
        item.price != null ? field('預估單價', el('span', { text: yen(item.price) })) : null,
        item.total != null ? field('預估總價', el('span', { text: yen(item.total) })) : null,
      ),
    );
  }
  if (item.note.length) rows.push(field('備註', el('p', { class: 'note' }, noteContent(item.note))));

  const draft = state.drafts.get(item.id) ?? item.rating;
  const save = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: '儲存評分', disabled: draft === item.rating });
  const textarea = el('textarea', {
    id: `rating-${item.id}`,
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
  rows.push(
    el('div', { class: 'rating' }, el('label', { class: 'field-label', for: textarea.id, text: '評分 / 心得' }), textarea, save),
  );

  return el('div', { class: 'item-detail' }, rows);
}

function toggleFilterPanel(open = $('filter-panel').hidden) {
  $('filter-panel').hidden = !open;
  $('scrim').hidden = !open;
  $('filter-toggle').setAttribute('aria-expanded', String(open));
  render();
}

// ---- 圖片放大 ----

const lightbox = { images: [], index: 0 };

function openLightbox(images, index) {
  lightbox.images = images;
  lightbox.index = index;
  showLightboxImage();
  $('lightbox').showModal();
}

function showLightboxImage() {
  const { images, index } = lightbox;
  $('lightbox-img').src = images[index];
  $('lightbox-count').textContent = `${index + 1} / ${images.length}`;
  document.querySelector('.lightbox-nav').hidden = images.length < 2;
}

function stepLightbox(delta) {
  const n = lightbox.images.length;
  if (n < 2) return;
  lightbox.index = (lightbox.index + delta + n) % n;
  showLightboxImage();
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
$('scrim').addEventListener('click', () => toggleFilterPanel(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('filter-panel').hidden) toggleFilterPanel(false);
});

const dialog = $('lightbox');
dialog.querySelector('.lightbox-close').addEventListener('click', () => dialog.close());
// 點圖片以外的暗色區域就關閉
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});
$('lightbox-prev').addEventListener('click', () => stepLightbox(-1));
$('lightbox-next').addEventListener('click', () => stepLightbox(1));
dialog.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') stepLightbox(-1);
  if (e.key === 'ArrowRight') stepLightbox(1);
});
let swipeX = null;
dialog.addEventListener('pointerdown', (e) => (swipeX = e.clientX));
dialog.addEventListener('pointerup', (e) => {
  if (swipeX !== null && Math.abs(e.clientX - swipeX) > 40) stepLightbox(e.clientX < swipeX ? 1 : -1);
  swipeX = null;
});

initThemeToggles();

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

function onItemCreated(item) {
  state.items.push(item);
  render();
  const hidden = !matches(item);
  toast(hidden ? `已新增「${item.name}」（目前的篩選條件下不會顯示）` : `已新增「${item.name}」`);
}

async function init() {
  initSwitcher(slug);
  initInstall();
  initAddItem({
    slug,
    getOptions: () => state.options,
    onCreated: onItemCreated,
    onUnauthorized: () => showLogin(state.name),
  });
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
