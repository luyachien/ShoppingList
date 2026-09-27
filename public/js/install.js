// 安裝到手機主畫面：Android（Chrome 等）用系統安裝提示；iPhone 無法用程式觸發，改顯示操作教學
import { initSheet, toast } from './common.js';

const $ = (id) => document.getElementById(id);

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function initInstall() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (isStandalone()) return;

  const button = $('install');
  const help = $('install-help');
  initSheet(help);
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    button.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    button.hidden = true;
    toast('已加入主畫面');
  });

  if (isIOS()) button.hidden = false;

  button.addEventListener('click', async () => {
    if (!deferredPrompt) return help.showModal();
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') button.hidden = true;
  });
}
