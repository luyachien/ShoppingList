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
  for (const child of children.flat()) {
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
