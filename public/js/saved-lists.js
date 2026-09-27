// 這支手機開過的清單（只存 slug 與名稱，不存密碼或商品資料）與切換視窗
import { el, initSheet, storage } from './common.js';

const KEY = 'sl_saved_lists';
const SLUG_RE = /^[A-Za-z0-9_-]{16,64}$/;
const $ = (id) => document.getElementById(id);

export function getSaved() {
  const list = storage.get(KEY, []);
  return Array.isArray(list) ? list.filter((l) => SLUG_RE.test(l?.slug)) : [];
}

export function rememberList(slug, name) {
  const others = getSaved().filter((l) => l.slug !== slug);
  storage.set(KEY, [{ slug, name, lastOpened: Date.now() }, ...others].slice(0, 20));
}

function forgetList(slug) {
  storage.set(
    KEY,
    getSaved().filter((l) => l.slug !== slug),
  );
}

// 接受完整分享網址（任何網域）或單純的清單代碼
function slugFromInput(input) {
  const text = String(input || '').trim();
  let path = text;
  try {
    path = new URL(text).pathname;
  } catch {
    // 不是網址
  }
  const m = path.match(/\/l\/([A-Za-z0-9_-]+)/) ?? [null, path];
  return SLUG_RE.test(m[1]) ? m[1] : null;
}

export function initSwitcher(currentSlug) {
  const dialog = $('switcher');
  initSheet(dialog);

  const render = () => {
    const lists = getSaved();
    $('saved-lists').replaceChildren(
      ...lists.map((l) =>
        el(
          'li',
          { class: `saved-list${l.slug === currentSlug ? ' is-current' : ''}` },
          el(
            'a',
            { href: `/l/${l.slug}`, 'aria-current': l.slug === currentSlug ? 'page' : null },
            el('span', { class: 'saved-name', text: l.name || '購物清單' }),
            l.slug === currentSlug ? el('span', { class: 'saved-badge', text: '目前' }) : null,
          ),
          l.slug === currentSlug
            ? null
            : el('button', {
                type: 'button',
                class: 'icon-btn',
                'aria-label': `從這支手機移除「${l.name}」`,
                text: '✕',
                onClick: () => {
                  forgetList(l.slug);
                  render();
                  updateButtons();
                },
              }),
        ),
      ),
    );
    if (!lists.length) $('saved-lists').append(el('li', { class: 'muted', text: '還沒有開過的清單' }));
  };

  // 登入頁與錯誤頁：有其他清單時才顯示「我的其他清單」
  const updateButtons = () => {
    const hasOthers = getSaved().some((l) => l.slug !== currentSlug);
    for (const btn of document.querySelectorAll('#login .open-switcher, #fatal .open-switcher')) btn.hidden = !hasOthers;
  };

  for (const btn of document.querySelectorAll('.open-switcher')) {
    btn.addEventListener('click', () => {
      render();
      $('add-list-error').textContent = '';
      dialog.showModal();
    });
  }

  $('add-list-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const slug = slugFromInput($('add-list-url').value);
    if (!slug) {
      $('add-list-error').textContent = '看不懂這個網址，請貼上完整的清單分享網址';
      return;
    }
    location.href = `/l/${slug}`;
  });

  updateButtons();
}
