export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    const err = new Error('網路連線失敗，請確認手機有網路');
    err.status = 0;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `發生錯誤（${res.status}）`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// 建立 DOM 元素；文字一律走 textContent，避免 XSS
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// 與 replaceChildren 相同，但略過 null（否則會顯示成文字 "null"）
export function fill(node, ...children) {
  node.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
}

let toastTimer;
export function toast(message, { actionLabel, onAction, duration = 3500 } = {}) {
  let box = document.getElementById('toast');
  if (!box) {
    box = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  box.replaceChildren(el('span', { text: message }));
  if (actionLabel && onAction) {
    box.append(
      el('button', {
        type: 'button',
        class: 'toast-action',
        text: actionLabel,
        onClick: () => {
          box.classList.remove('show');
          onAction();
        },
      }),
    );
  }
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), duration);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const input = el('textarea', { readonly: true, style: 'position:fixed;opacity:0' });
    input.value = text;
    document.body.append(input);
    input.select();
    const ok = document.execCommand('copy');
    input.remove();
    return ok;
  }
}

export const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 私密瀏覽等情況無法儲存，不影響功能
    }
  },
};

export const yen = (n) => `¥${Number(n).toLocaleString('ja-JP')}`;

// ---- 外觀切換：深色 ⇄ 淺色（預設跟隨系統，實際套用在 theme.js） ----

const THEME_ICONS = {
  light:
    '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
};

// 按鈕顯示「按下後會切換成」的模式：淺色時顯示月亮，深色時顯示太陽
function paintThemeButton(button) {
  const next = window.slTheme.get() === 'dark' ? 'light' : 'dark';
  // 圖示為程式內的固定字串，不含任何使用者資料
  button.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${THEME_ICONS[next]}</svg>`;
  button.setAttribute('aria-label', `切換為${window.slTheme.LABELS[next]}`);
  button.title = `切換為${window.slTheme.LABELS[next]}`;
}

export function initThemeToggles() {
  const buttons = document.querySelectorAll('.theme-toggle');
  const repaint = () => buttons.forEach(paintThemeButton);
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const mode = window.slTheme.toggle();
      repaint();
      toast(`已切換為${window.slTheme.LABELS[mode]}`, { duration: 1500 });
    });
  }
  // 跟隨系統時，系統切換深淺色也要更新按鈕圖示
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint);
  repaint();
}
