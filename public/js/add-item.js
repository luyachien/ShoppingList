// 商品表單（新增商品、出發前編輯商品共用）：選項（種類、Tag、需要的人、需要程度）依 Notion 資料庫動態產生
import { api, el, initSheet, toast, toggleChip } from './common.js';
import { photoField, uploadPhotos } from './photos.js';

const $ = (id) => document.getElementById(id);

function textField(label, props, value = '') {
  const input = el('input', { class: 'field-input', ...props });
  input.value = value;
  return { input, node: el('label', { class: 'form-field' }, el('span', { class: 'field-label', text: label }), input) };
}

// 用 chip 做單選 / 多選，比下拉選單更好用單手點選
function chipField(label, options, { multiple, initial = [] }) {
  const selected = new Set(initial);
  const wrap = el('div', { class: 'chip-wrap' });
  const paint = () => {
    wrap.replaceChildren(
      ...options.map((o) =>
        toggleChip({
          label: o.name,
          color: o.color,
          pressed: selected.has(o.name),
          onClick: () => {
            if (selected.has(o.name)) selected.delete(o.name);
            else {
              if (!multiple) selected.clear();
              selected.add(o.name);
            }
            paint();
          },
        }),
      ),
    );
  };
  paint();
  return {
    node: options.length
      ? el('fieldset', { class: 'form-field filter-group' }, el('legend', { text: label }), wrap)
      : null,
    value: () => (multiple ? [...selected] : ([...selected][0] ?? '')),
  };
}

const noteText = (note) => note.map((t) => t.text).join('');

// 編輯時的原始值，與表單值用同樣的格式比較
function originalValues(item) {
  return {
    brand: item.brand ?? '',
    name: item.name,
    qty: item.qty ?? '',
    price: item.price ?? '',
    shop: item.shop ?? '',
    source: item.source ?? '',
    note: noteText(item.note),
    category: item.category ?? '',
    priority: item.priority ?? '',
    tags: item.tags,
    people: item.people,
  };
}

const sameValue = (a, b) =>
  Array.isArray(a) ? a.length === b.length && a.every((v) => b.includes(v)) : String(a).trim() === String(b).trim();

export function initAddItem({ slug, getOptions, canAddPhotos, onCreated, onUpdated, onEditLocked, onUnauthorized }) {
  const dialog = $('add-dialog');
  const form = $('add-form');
  const submit = form.querySelector('button[type="submit"]');
  initSheet(dialog);
  let fields = null;
  let editing = null; // 正在編輯的商品；null 代表新增
  const submitLabel = () => (editing ? '儲存到 Notion' : '新增到 Notion');

  const build = () => {
    const options = getOptions();
    const start = editing ? originalValues(editing) : { qty: '1' };
    const brand = textField('品牌（選填）', { name: 'brand', maxlength: 60, placeholder: '例：DAISO', autocomplete: 'off' }, start.brand);
    const name = textField('商品名稱 *', { name: 'name', maxlength: 200, required: true, autocomplete: 'off' }, start.name);
    const qty = textField('數量', { name: 'qty', type: 'number', inputmode: 'numeric', min: 1, max: 999, step: 1 }, start.qty);
    const price = textField('預估單價（¥，含稅）', { name: 'price', type: 'number', inputmode: 'numeric', min: 0, step: 1 }, start.price);
    const shop = textField('商店', { name: 'shop', maxlength: 200, autocomplete: 'off' }, start.shop);
    const source = textField('推薦來源網址', { name: 'source', type: 'url', inputmode: 'url', placeholder: 'https://…' }, start.source);
    const note = el('textarea', { class: 'field-input', name: 'note', rows: 3, maxlength: 2000 });
    note.value = start.note ?? '';
    // 網站只能寫入純文字，原本在 Notion 設定的格式會在儲存備註時遺失
    const noteWarning = editing?.note.some((t) => t.bold || t.href)
      ? el('p', { class: 'hint warning-text', text: '⚠️ 這則備註含有粗體或連結，修改備註並儲存後，格式會變成純文字。不改備註就不會影響。' })
      : null;

    fields = {
      brand: brand.input,
      name: name.input,
      qty: qty.input,
      price: price.input,
      shop: shop.input,
      source: source.input,
      note,
      category: chipField('種類', options.category, { multiple: false, initial: start.category ? [start.category] : [] }),
      priority: chipField('需要程度', options.priority, { multiple: false, initial: start.priority ? [start.priority] : [] }),
      tags: chipField('購買地點（Tag）', options.tags, { multiple: true, initial: start.tags }),
      people: chipField('需要的人', options.people, { multiple: true, initial: start.people }),
      // 編輯時照片改用商品詳細資料的「📷 新增照片」
      photos: !editing && canAddPhotos() ? photoField({ onError: (msg) => ($('add-error').textContent = msg) }) : null,
    };

    $('add-fields').replaceChildren(
      ...[
        brand.node,
        name.node,
        fields.category.node,
        fields.priority.node,
        fields.tags.node,
        fields.people.node,
        el('div', { class: 'field-pair' }, qty.node, price.node),
        shop.node,
        source.node,
        el('label', { class: 'form-field' }, el('span', { class: 'field-label', text: '備註' }), note, noteWarning),
        fields.photos?.node,
      ].filter(Boolean),
    );
  };

  const open = (item = null) => {
    fields?.photos?.clear();
    editing = item;
    $('add-title').textContent = item ? '編輯商品' : '新增商品';
    build();
    $('add-error').textContent = '';
    submit.disabled = false;
    submit.textContent = submitLabel();
    dialog.showModal();
    fields.name.focus();
  };

  const readForm = () => ({
    brand: fields.brand.value,
    name: fields.name.value,
    qty: fields.qty.value,
    price: fields.price.value,
    shop: fields.shop.value,
    source: fields.source.value,
    note: fields.note.value,
    category: fields.category.value(),
    priority: fields.priority.value(),
    tags: fields.tags.value(),
    people: fields.people.value(),
  });

  // 只送出有改動的欄位，避免覆蓋其他人同時在 Notion 做的修改
  const changedFields = (item, values) => {
    const original = originalValues(item);
    const changes = {};
    for (const [key, value] of Object.entries(values)) {
      if (!sameValue(value, original[key])) changes[key] = value;
    }
    // 品牌存在商品名稱裡，任一改動都要一起送
    if ('brand' in changes || 'name' in changes) {
      changes.brand = values.brand;
      changes.name = values.name;
    }
    return changes;
  };

  async function create(item) {
    const { item: created } = await api('/api/list?action=create', { method: 'POST', body: { slug, item } });
    const blobs = fields.photos?.blobs() ?? [];
    let photoError = null;
    let result = created;
    try {
      result = (await uploadPhotos(slug, created.id, blobs, (i, n) => (submit.textContent = `上傳照片 ${i}/${n}…`))) ?? created;
    } catch (err) {
      photoError = err;
    }
    dialog.close();
    fields.photos?.clear();
    onCreated(result);
    // 商品已建立，照片失敗只提示，可之後在商品詳細資料補上
    if (photoError) toast(`商品已新增，但照片上傳失敗：${photoError.message}`, { duration: 6000 });
  }

  async function save(values) {
    const changes = changedFields(editing, values);
    if (!Object.keys(changes).length) {
      dialog.close();
      return toast('沒有變更');
    }
    const { item: updated } = await api('/api/list?action=edit', {
      method: 'POST',
      body: { slug, pageId: editing.id, item: changes },
    });
    dialog.close();
    onUpdated(updated);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = readForm();
    if (!values.name.trim()) {
      $('add-error').textContent = '請輸入商品名稱';
      fields.name.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = editing ? '儲存中…' : '新增中…';
    $('add-error').textContent = '';
    try {
      await (editing ? save(values) : create(values));
    } catch (err) {
      if (err.status === 401) {
        dialog.close();
        return onUnauthorized();
      }
      // 頁面開著時跨過了出發日：伺服器拒絕，畫面也改成鎖定
      if (err.status === 403 && editing) {
        dialog.close();
        return onEditLocked(err.message);
      }
      $('add-error').textContent = err.message;
    } finally {
      submit.disabled = false;
      submit.textContent = submitLabel();
    }
  });

  $('add-open').addEventListener('click', () => open());
  return { openEdit: (item) => open(item) };
}
