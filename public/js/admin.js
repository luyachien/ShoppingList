import { api, copyText, el, fill, toast } from './common.js';

const $ = (id) => document.getElementById(id);
const shareUrl = (slug) => `${location.origin}/l/${slug}`;

function show(id) {
  for (const section of ['loading', 'login', 'main']) $(section).hidden = section !== id;
}

async function init() {
  try {
    const { admin } = await api('/api/admin?action=session');
    if (!admin) return showLogin();
    show('main');
    await loadLists();
  } catch (err) {
    showLogin(err.message);
  }
}

function showLogin(message = '') {
  show('login');
  $('login-error').textContent = message;
  $('login-password').focus();
}

// ---- 轉換流程 ----

let inspected = null;

async function inspect(url) {
  const box = $('inspect-result');
  box.replaceChildren(el('div', { class: 'spinner spinner-sm' }));
  $('share-step').hidden = true;
  inspected = null;
  try {
    inspected = await api('/api/admin?action=inspect', { method: 'POST', body: { url } });
    renderInspect(url);
  } catch (err) {
    if (err.status === 401) return showLogin(err.message);
    box.replaceChildren(el('p', { class: 'error', text: err.message }));
  }
}

function renderInspect(url) {
  const info = inspected;
  const box = $('inspect-result');
  const header = el(
    'div',
    { class: 'inspect-head' },
    el('p', { class: 'inspect-title', text: info.title }),
    el('p', { class: 'muted', text: info.errors.length ? '不符合模板' : `符合模板 · ${info.itemCount} 項商品` }),
  );

  if (info.errors.length) {
    box.replaceChildren(
      header,
      el('p', { class: 'error', text: '這個資料庫不符合購物清單模板，請修正以下欄位後再試：' }),
      el('ul', { class: 'problems' }, info.errors.map((e) => el('li', { text: e }))),
    );
    return;
  }

  const warnings = info.warnings.length
    ? el(
        'details',
        { class: 'warnings' },
        el('summary', { text: `${info.warnings.length} 個選用欄位缺少，網站上不會顯示` }),
        el('ul', {}, info.warnings.map((w) => el('li', { text: w }))),
      )
    : null;

  if (info.existing) {
    fill(box, 
      header,
      warnings,
      el('p', { class: 'notice', text: '這個資料庫已經轉換過了，分享網址不變。需要時可在下方「已轉換的清單」修改密碼。' }),
      shareBox(info.existing.slug),
    );
    return;
  }

  const pw = el('input', { type: 'password', placeholder: '清單密碼（至少 4 個字元）', autocomplete: 'new-password', minlength: 4, required: true });
  const pw2 = el('input', { type: 'password', placeholder: '再輸入一次', autocomplete: 'new-password', required: true });
  const error = el('p', { class: 'error', role: 'alert' });
  const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: '建立分享網址' });
  const form = el(
    'form',
    { class: 'stack' },
    el('h2', {}, el('span', { class: 'step-no', text: '2' }), '設定這個清單的使用密碼'),
    el('p', { class: 'hint muted', text: '旅伴需要輸入這組密碼才能查看與修改清單。密碼不會以明碼儲存，建立後無法查看，請自行記下。' }),
    pw,
    pw2,
    submit,
    error,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    if (pw.value !== pw2.value) return (error.textContent = '兩次輸入的密碼不一致');
    submit.disabled = true;
    try {
      const { slug } = await api('/api/admin?action=create', { method: 'POST', body: { url, password: pw.value } });
      box.replaceChildren(header, el('p', { class: 'success', text: '✓ 已建立分享網址' }));
      $('share-result').replaceChildren(shareBox(slug));
      $('share-step').hidden = false;
      $('share-step').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('notion-url').value = '';
      loadLists();
    } catch (err) {
      if (err.status === 401) return showLogin(err.message);
      error.textContent = err.message;
      submit.disabled = false;
    }
  });
  fill(box, header, warnings, form);
}

function shareBox(slug) {
  const url = shareUrl(slug);
  const buttons = [
    el('button', {
      type: 'button',
      class: 'btn btn-primary btn-sm',
      text: '複製網址',
      onClick: async () => toast((await copyText(url)) ? '已複製網址' : '無法複製，請手動選取'),
    }),
    el('a', { class: 'btn btn-ghost btn-sm', href: url, target: '_blank', rel: 'noopener', text: '開啟清單' }),
  ];
  if (navigator.share) {
    buttons.splice(
      1,
      0,
      el('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        text: '分享…',
        onClick: () => navigator.share({ title: '購物清單', url }).catch(() => {}),
      }),
    );
  }
  return el('div', { class: 'share-box' }, el('code', { class: 'share-url', text: url }), el('div', { class: 'btn-row' }, buttons));
}

// ---- 已轉換的清單 ----

async function loadLists() {
  try {
    const { lists } = await api('/api/admin?action=lists');
    $('lists').replaceChildren(...lists.map(renderListCard));
    $('lists-empty').hidden = lists.length > 0;
  } catch (err) {
    if (err.status === 401) return showLogin(err.message);
    toast(`無法載入清單：${err.message}`);
  }
}

function renderListCard(list) {
  const created = new Date(list.createdTime).toLocaleDateString('zh-TW');
  const toggle = el('input', { type: 'checkbox', role: 'switch', checked: list.enabled });
  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    try {
      await api('/api/admin?action=update', { method: 'POST', body: { slug: list.slug, enabled: toggle.checked } });
      toast(toggle.checked ? '已啟用' : '已停用，旅伴將無法開啟此網址');
      card.classList.toggle('is-disabled', !toggle.checked);
    } catch (err) {
      toggle.checked = !toggle.checked;
      toast(err.message);
    } finally {
      toggle.disabled = false;
    }
  });

  const pwForm = el('form', { class: 'stack pw-form', hidden: true });
  const pwInput = el('input', { type: 'password', placeholder: '新密碼（至少 4 個字元）', autocomplete: 'new-password', minlength: 4, required: true });
  pwForm.append(pwInput, el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: '儲存新密碼' }));
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin?action=update', { method: 'POST', body: { slug: list.slug, password: pwInput.value } });
      pwInput.value = '';
      pwForm.hidden = true;
      toast('密碼已更新，旅伴需要用新密碼重新登入');
    } catch (err) {
      toast(err.message);
    }
  });

  const card = el(
    'li',
    { class: `card list-card${list.enabled ? '' : ' is-disabled'}` },
    el(
      'div',
      { class: 'list-card-head' },
      el('div', {}, el('p', { class: 'list-name', text: list.name }), el('p', { class: 'muted small', text: `建立於 ${created}` })),
      el('label', { class: 'switch' }, toggle, el('span', { class: 'switch-label', text: '啟用' })),
    ),
    shareBox(list.slug),
    el('button', {
      type: 'button',
      class: 'btn btn-ghost btn-sm',
      text: '修改密碼',
      onClick: () => {
        pwForm.hidden = !pwForm.hidden;
        if (!pwForm.hidden) pwInput.focus();
      },
    }),
    pwForm,
  );
  return card;
}

// ---- 事件 ----

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button');
  button.disabled = true;
  $('login-error').textContent = '';
  try {
    await api('/api/admin?action=login', { method: 'POST', body: { password: $('login-password').value } });
    $('login-password').value = '';
    show('main');
    loadLists();
  } catch (err) {
    $('login-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/admin?action=logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

$('inspect-form').addEventListener('submit', (e) => {
  e.preventDefault();
  inspect($('notion-url').value.trim());
});

init();
