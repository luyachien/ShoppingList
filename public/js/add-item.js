// 新增商品表單：選項（種類、Tag、需要的人、需要程度）依 Notion 資料庫動態產生
import { api, el, initSheet, toast, toggleChip } from './common.js';
import { photoField, uploadPhotos } from './photos.js';

const $ = (id) => document.getElementById(id);

function textField(label, props) {
  const input = el('input', { class: 'field-input', ...props });
  return { input, node: el('label', { class: 'form-field' }, el('span', { class: 'field-label', text: label }), input) };
}

// 用 chip 做單選 / 多選，比下拉選單更好用單手點選
function chipField(label, options, { multiple }) {
  const selected = new Set();
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

export function initAddItem({ slug, getOptions, canAddPhotos, onCreated, onUnauthorized }) {
  const dialog = $('add-dialog');
  const form = $('add-form');
  const submit = form.querySelector('button[type="submit"]');
  initSheet(dialog);
  let fields = null;

  const build = () => {
    const options = getOptions();
    const brand = textField('品牌（選填）', { name: 'brand', maxlength: 60, placeholder: '例：DAISO', autocomplete: 'off' });
    const name = textField('商品名稱 *', { name: 'name', maxlength: 200, required: true, autocomplete: 'off' });
    const qty = textField('數量', { name: 'qty', type: 'number', inputmode: 'numeric', min: 1, max: 999, step: 1 });
    qty.input.value = '1';
    const price = textField('預估單價（¥，含稅）', { name: 'price', type: 'number', inputmode: 'numeric', min: 0, step: 1 });
    const shop = textField('商店', { name: 'shop', maxlength: 200, autocomplete: 'off' });
    const source = textField('推薦來源網址', { name: 'source', type: 'url', inputmode: 'url', placeholder: 'https://…' });
    const note = el('textarea', { class: 'field-input', name: 'note', rows: 3, maxlength: 2000 });

    fields = {
      brand: brand.input,
      name: name.input,
      qty: qty.input,
      price: price.input,
      shop: shop.input,
      source: source.input,
      note,
      category: chipField('種類', options.category, { multiple: false }),
      priority: chipField('需要程度', options.priority, { multiple: false }),
      tags: chipField('購買地點（Tag）', options.tags, { multiple: true }),
      people: chipField('需要的人', options.people, { multiple: true }),
      photos: canAddPhotos() ? photoField({ onError: (msg) => ($('add-error').textContent = msg) }) : null,
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
        el('label', { class: 'form-field' }, el('span', { class: 'field-label', text: '備註' }), note),
        fields.photos?.node,
      ].filter(Boolean),
    );
  };

  const open = () => {
    fields?.photos?.clear();
    build();
    $('add-error').textContent = '';
    submit.disabled = false;
    dialog.showModal();
    fields.name.focus();
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const item = {
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
    };
    if (!item.name.trim()) {
      $('add-error').textContent = '請輸入商品名稱';
      fields.name.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = '新增中…';
    $('add-error').textContent = '';
    try {
      const { item: created } = await api('/api/list?action=create', { method: 'POST', body: { slug, item } });
      const blobs = fields.photos?.blobs() ?? [];
      let photoError = null;
      let result = created;
      try {
        result =
          (await uploadPhotos(slug, created.id, blobs, (i, n) => (submit.textContent = `上傳照片 ${i}/${n}…`))) ?? created;
      } catch (err) {
        photoError = err;
      }
      dialog.close();
      fields.photos?.clear();
      onCreated(result);
      // 商品已建立，照片失敗只提示，可之後在商品詳細資料補上
      if (photoError) toast(`商品已新增，但照片上傳失敗：${photoError.message}`, { duration: 6000 });
    } catch (err) {
      if (err.status === 401) {
        dialog.close();
        return onUnauthorized();
      }
      $('add-error').textContent = err.message;
    } finally {
      submit.disabled = false;
      submit.textContent = '新增到 Notion';
    }
  });

  $('add-open').addEventListener('click', open);
}
