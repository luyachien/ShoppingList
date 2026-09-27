// 以一般 <script>（非 module）在 <head> 同步執行，避免頁面先閃一下錯誤配色
// 預設跟隨系統；使用者按過切換按鈕後，改用他選的深色或淺色
(function () {
  var KEY = 'sl_theme';
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var chosen = null; // null = 跟隨系統

  try {
    var saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') chosen = saved;
  } catch (e) {
    // 無法讀取時使用系統設定
  }

  function current() {
    return chosen || (media.matches ? 'dark' : 'light');
  }

  function apply() {
    var theme = current();
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#191919' : '#f7f6f3';
  }

  window.slTheme = {
    LABELS: { light: '淺色模式', dark: '深色模式' },
    get: current,
    toggle: function () {
      chosen = current() === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, chosen);
      } catch (e) {
        // 無法儲存時只影響本次瀏覽
      }
      apply();
      return chosen;
    },
  };

  media.addEventListener('change', apply);
  apply();
})();
