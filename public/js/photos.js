// 商品照片：在手機上先壓縮，再逐張上傳到 Notion「檔案和媒體」
import { api, el, infoTip } from './common.js';

export const PHOTO_MAX_COUNT = 5;
// 可一次選多張時，Android 的選擇畫面不會出現「拍照」
export const ANDROID_CAMERA_NOTE = 'Android 手機無法在這裡直接拍照，請先用相機拍好，再從相簿選取。';
const MAX_EDGE = 1600;
const MAX_BYTES = 4 * 1024 * 1024; // 與伺服器上限相同（Vercel 請求上限 4.5MB）

// 縮到長邊 1600px 並轉成 JPEG；手機原圖常有 3～10MB，直接傳會超過上限
export async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = el('canvas', {
      width: Math.round(img.naturalWidth * scale),
      height: Math.round(img.naturalHeight * scale),
    });
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (blob) return blob;
  } catch {
    // 瀏覽器無法解碼（例如部分 HEIC）就送原檔，交給伺服器檢查格式
  } finally {
    URL.revokeObjectURL(url);
  }
  return file;
}

// 依序上傳（Notion 限速，且每張都要接在前一張之後），回傳最後更新的商品
export async function uploadPhotos(slug, itemId, blobs, onProgress) {
  let item = null;
  for (const [i, blob] of blobs.entries()) {
    onProgress?.(i + 1, blobs.length);
    if (blob.size > MAX_BYTES) throw new Error('照片太大（上限 4MB）');
    const params = new URLSearchParams({ action: 'photo', slug, pageId: itemId, type: blob.type || 'image/jpeg' });
    ({ item } = await api(`/api/list?${params}`, { method: 'POST', body: blob }));
  }
  return item;
}

// 開啟系統的照片選擇器（手機上可拍照或從相簿選），回傳壓縮後的照片
export function pickPhotos(max) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept: 'image/*', multiple: max > 1, hidden: true });
    input.addEventListener('change', async () => {
      const files = [...input.files];
      input.remove();
      resolve({ blobs: await Promise.all(files.slice(0, max).map(compressImage)), skipped: Math.max(0, files.length - max) });
    });
    // 取消選擇時不會觸發 change，promise 保持 pending 即可
    input.addEventListener('cancel', () => input.remove());
    document.body.append(input);
    input.click();
  });
}

// 新增商品表單內的照片欄：預覽縮圖、可移除，最多 PHOTO_MAX_COUNT 張
export function photoField({ onError }) {
  const photos = []; // { blob, url }
  const grid = el('div', { class: 'photo-grid' });
  const hint = el('p', { class: 'hint muted' });

  const paint = () => {
    const addButton =
      photos.length < PHOTO_MAX_COUNT
        ? el('button', {
            type: 'button',
            class: 'photo-add',
            'aria-label': '加入照片',
            text: '＋',
            onClick: async () => {
              const { blobs, skipped } = await pickPhotos(PHOTO_MAX_COUNT - photos.length);
              photos.push(...blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) })));
              if (skipped) onError(`最多 ${PHOTO_MAX_COUNT} 張，已略過 ${skipped} 張`);
              paint();
            },
          })
        : null;
    grid.replaceChildren(
      ...photos.map((p, i) =>
        el(
          'div',
          { class: 'photo-thumb' },
          el('img', { src: p.url, alt: `第 ${i + 1} 張照片` }),
          el('button', {
            type: 'button',
            class: 'photo-remove',
            'aria-label': `移除第 ${i + 1} 張照片`,
            text: '×',
            onClick: () => {
              URL.revokeObjectURL(p.url);
              photos.splice(i, 1);
              paint();
            },
          }),
        ),
      ),
      ...(addButton ? [addButton] : []),
    );
    hint.textContent = `${photos.length} / ${PHOTO_MAX_COUNT} 張，上傳前會自動縮小`;
  };
  paint();

  return {
    node: el(
      'div',
      { class: 'form-field' },
      el('div', { class: 'label-row' }, el('span', { class: 'field-label', text: '照片（選填）' }), infoTip(ANDROID_CAMERA_NOTE, '照片說明')),
      grid,
      hint,
    ),
    blobs: () => photos.map((p) => p.blob),
    clear: () => {
      for (const p of photos) URL.revokeObjectURL(p.url);
      photos.length = 0;
    },
  };
}
