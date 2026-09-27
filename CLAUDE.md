# CLAUDE.md

這份文件是給 Claude Code（以及任何協作者）的專案指引。開始任何工作前請先讀完。

## Project overview

**ShoppingList** 是一個「Notion 購物清單 → 手機購物網站」的**轉換器**。

使用情境：擁有者每次出國旅行前，會在 Notion 用固定的「購物清單模板」建立一個該趟行程專用的 Database（例如「2027福岡購物清單」），規劃要買的商品與伴手禮。
出發後：

1. 擁有者在轉換器頁面貼上該 Database 的 Notion 網址 → 按「轉換」
2. 網站驗證它符合模板，產生一個該趟行程專用的手機網頁，並讓擁有者設定這個清單的**使用密碼**
3. 擁有者把網址與密碼傳給旅伴；旅伴輸入密碼後即可在手機上查看清單、標記已購買、填寫評分
4. 所有修改即時寫回 Notion；Notion 是唯一資料來源

## Goals

必要功能（MVP）：

**轉換器（僅擁有者可用，需管理密碼）**
1. 輸入 Notion Database 網址（公開檢視網址或一般連結皆可），從中取出 Database ID
2. 驗證該 Database 的欄位符合模板（見下方「Notion 模板」）；不符合時列出缺少或型別錯誤的欄位
3. 為這個清單設定使用密碼，產生分享網址 `/l/<slug>`
4. 可以查看已轉換的清單、修改密碼、停用清單

**清單頁（擁有者與旅伴，需清單密碼）**
1. 預設顯示「未購買」商品，可切換顯示已購買 / 全部
2. 顯示商品圖片（檔案和媒體，點擊後在畫面中央放大、可左右切換）、品牌、種類、Tag（購買地點）、需要程度、需要的人、數量、預估單價與總價、備註（保留粗體與超連結）
3. 篩選：種類、Tag、需要的人、需要程度、狀態；「篩選與排序」面板位於 sticky header 內，捲到任何位置打開都出現在畫面頂部
4. 排序：需要程度、預估單價、商品名稱、品牌；「預估合計」一律以預估總價加總
5. 搜尋：商品名稱、商店、備註
6. 一鍵切換「未購買 ↔ 已購買」，寫回 Notion「狀態」欄位
7. 填寫 / 修改「評分」欄位（購買後的使用 / 食用心得與評分），寫回 Notion
8. 手動重新整理，取得 Notion 最新資料
9. 「推薦來源」以按鈕顯示在「已購買」勾選按鈕左側
10. 外觀切換：深色 ⇄ 淺色兩段切換；未切換前預設跟隨系統，選擇後存在 localStorage
11. 新增商品（右下角按鈕）：可填品牌、名稱、種類、需要程度、Tag、需要的人、數量、單價、商店、推薦來源、備註；選項只能選 Notion 中已存在的；不支援上傳照片
12. 切換清單：點標題開啟「我的購物清單」，列出這支手機開過的清單（localStorage，只存 slug 與名稱），也可貼上分享網址加入
13. 安裝到主畫面（PWA）：Android 用系統安裝提示；iOS 顯示「分享 → 加入主畫面」教學。Service worker 刻意不快取任何內容
14. 資料庫標題同步：讀取商品與管理頁清單時，以 Notion 最新標題更新轉換紀錄的「名稱」
15. 分享預覽：/l/<slug> 由 api/list.js 伺服器端輸出 HTML，帶入清單名稱與 og-image.png（LINE 等預覽不執行 JS）
16. 「在 Notion 開啟」連結（清單頁摘要列、管理頁清單卡片）：能否查看由 Notion 權限決定，網站無法也不需判斷；資料庫若在 Notion「發布到網路」，任何人都能唯讀瀏覽

非目標（除非擁有者明確要求，否則不要做）：

- 使用者帳號系統（只有「管理密碼」和「每個清單的密碼」兩種）
- 在網站上刪除商品，或編輯既有商品「狀態、評分」以外的欄位（請在 Notion 操作）
- 在網站上新增 Notion 選項（Tag、需要的人等）或上傳商品照片
- 支援模板以外的任意 Notion Database
- 即時推播、輪詢、離線模式（service worker 不快取）

## Notion 模板

所有要轉換的 Database 都必須使用這個模板（以「2027福岡購物清單」為基準）。
程式碼中只有 `api/_lib/template.js` 可以出現這些欄位名稱。

| 欄位 | 型別 | 網站用途 |
|---|---|---|
| 商品名稱 | title | 顯示、搜尋、排序；開頭的【】視為**品牌**，另外顯示（Notion 中不拆欄位） |
| 狀態 | status（未購買 / 已購買） | 顯示、篩選、**可寫入** |
| 評分 | rich_text | 顯示、**可寫入**（純文字輸入框，不做星等 UI） |
| 種類 | select（藥妝、食物、服飾、電器、其他） | 顯示、篩選 |
| Tag | multi_select（購買地點 / 商店類型） | 顯示、篩選 |
| 需要程度 | select（低 / 中 / 高） | 顯示、篩選、排序 |
| 需要的人 | multi_select | 顯示、篩選 |
| 最少購買數量 | number | 顯示 |
| 預估單價(含稅) | number（日圓） | 顯示、排序 |
| 預估總價(含稅) | formula（唯讀） | 顯示 |
| 商店 | rich_text | 顯示、搜尋 |
| 備註 | rich_text | 顯示、搜尋 |
| 商品推薦來源 | url | 連結 |
| 檔案和媒體 | files | 商品縮圖 |
| Inbox | checkbox | **網站完全忽略**（擁有者旅遊結束後在 Notion 自行核對用），不讀取、不顯示、不篩選 |

- **必要欄位**（缺少就拒絕轉換）：商品名稱、狀態、評分、種類
- 其他欄位缺少時該項資訊不顯示，不視為錯誤
- 選項值（例如 Tag 的商店名稱、需要的人）每趟旅行可能不同，一律從 Database schema 動態讀取，不寫死在程式碼中
- Notion 託管的圖片網址約 1 小時後失效，因此每次載入都要重新取得，不要快取網址

## Technical architecture

保持最小：**靜態前端 + 少量 Serverless API，部署在 Vercel。資料和轉換紀錄都存在 Notion，不另外架設資料庫。**

```
手機瀏覽器 ──▶ /api/*（Vercel Serverless，持有 Notion Token 與密鑰）──▶ Notion API
                                                                    ├─ 各趟行程的購物清單 Database
                                                                    └─ 「轉換紀錄」Database（slug、Database ID、密碼雜湊）
```

- **前端**：純 HTML + CSS + JavaScript（ES modules），不使用框架、不需要 build step
  - 篩選、排序、搜尋在前端處理（每趟清單資料量小）
- **後端**：Vercel Serverless Functions（Node.js 22），以內建 `fetch` 直接呼叫 Notion REST API（`Notion-Version: 2025-09-03`，使用 data source 端點），**零 npm 相依套件**
- **為什麼需要後端**：Notion Token 不能出現在瀏覽器；Notion API 也不允許瀏覽器直接呼叫（CORS）；密碼驗證必須在伺服器端進行

### Notion 存取方式

- **公開檢視網址只用來取得 Database ID**；讀寫資料一律透過官方 API + Integration Token（公開網址本身無法寫入，也不是穩定的 API）
- 網址中取出 32 字元的 ID；如果 ID 指向的是頁面而不是 Database，則讀取該頁面底下的第一個 Database
- 權限：擁有者建立一個 Notion Internal Integration，並把它連接（Connections）到上層頁面「🛍️ 購物清單」。之後在這個頁面底下複製模板建立的新 Database 會自動繼承權限，不需要每次重新連接
- 讀取：查詢 Database 的 data source，將 Notion property 轉成扁平 JSON
- 寫入：更新既有 page 只改「狀態」與「評分」；新增商品在該清單的 data source 建立 page（`toCreateProperties` 驗證所有欄位與選項）
- 限速：Notion API 平均約每秒 3 個請求；前端不輪詢，不批次大量寫入
- 同步策略：開頁面時載入、手動重新整理；寫入採樂觀更新（先改畫面，失敗則還原並提示）

### 轉換紀錄（存在 Notion）

「轉換紀錄」Database 位於獨立的私人頁面「⚙️ ShoppingList 系統設定」底下（與「🛍️ 購物清單」分開，兩個頁面都需連接 Integration）。每筆紀錄對應一個分享出去的清單：

| 欄位 | 型別 | 說明 |
|---|---|---|
| 名稱 | title | 預設使用該趟 Database 的標題 |
| slug | rich_text | 分享網址用的隨機代碼（不可猜測，至少 16 字元） |
| Database ID | rich_text | 對應的購物清單 Database |
| 密碼雜湊 | rich_text | scrypt 雜湊 + salt，**絕不存明碼** |
| 啟用 | checkbox | 取消勾選即停用該分享網址 |
| 建立時間 | created_time | Notion 自動產生 |

### 驗證與權限

- **管理密碼** `ADMIN_PASSWORD`（環境變數）：保護轉換器與清單管理功能，避免他人用你的 Database 自行產生分享網址
- **清單密碼**：每個清單各自一組，只存雜湊
- 驗證成功後，伺服器發給一個 HttpOnly、Secure、SameSite=Lax 的簽章 cookie（用 `SESSION_SECRET` 做 HMAC），限定該清單使用；修改密碼後舊 cookie 自動失效
- **每一個** API 請求都要在伺服器端驗證 cookie 與清單是否啟用；前端的隱藏或停用只是介面，不是安全機制
- 寫入 API 只能修改「該清單 Database 內」的頁面，且只能改「狀態」與「評分」；新增商品只能建在該清單 Database，選項值必須是 schema 中已存在的
- 密碼比對使用 constant-time 比較；錯誤時加入短暫延遲以減緩暴力嘗試

### 目錄結構

```
/
├─ public/
│  ├─ index.html        # 轉換器（管理頁）
│  ├─ list.html         # 清單頁範本（/l/<slug> → api/list.js?action=page 填入標題與預覽標籤後輸出）
│  ├─ js/
│  │  ├─ theme.js       # 一般 script，於 <head> 同步套用深 / 淺色
│  │  ├─ common.js      # fetch 包裝、DOM 建立（el / fill）、toast、localStorage、chip、sheet
│  │  ├─ admin.js       # 轉換器
│  │  ├─ list.js        # 清單頁
│  │  ├─ add-item.js    # 新增商品表單
│  │  ├─ saved-lists.js # 這支手機開過的清單與切換視窗
│  │  └─ install.js     # 安裝到主畫面
│  ├─ sw.js             # 只為可安裝性存在，不快取
│  ├─ style.css
│  ├─ icon.svg
│  ├─ icons/            # PWA / apple-touch-icon PNG
│  └─ og-image.png      # 分享預覽圖 1200×630
├─ api/
│  ├─ admin.js          # ?action=session|login|logout|lists|inspect|create|update
│  ├─ list.js           # ?action=page|manifest|info|login|items|create|update
│  └─ _lib/             # 底線開頭：Vercel 不會當成 API 路由
│     ├─ http.js        # JSON 回應、讀取 body、錯誤處理
│     ├─ notion.js      # Notion REST 呼叫、分頁、網址 → ID、頁面 → 子資料庫
│     ├─ template.js    # 模板欄位定義、驗證、property ↔ JSON 轉換
│     ├─ registry.js    # 轉換紀錄的讀寫
│     └─ auth.js        # scrypt 密碼雜湊、HMAC cookie
├─ scripts/dev.mjs      # 本機開發伺服器（模擬 Vercel 路由與 rewrite）
├─ vercel.json         # rewrite、api/list.js 的 includeFiles（讀取 public/list.html）
├─ .env.example
├─ .gitignore
├─ package.json
├─ README.md / README.en.md  # 給其他使用者的中英文設定教學（自行部署）
├─ LICENSE             # MIT
└─ CLAUDE.md
```

- API 函式只用 Node 原生 `req` / `res`（不依賴 Vercel 的 `res.status().json()` helper），才能同時在 Vercel 與 `scripts/dev.mjs` 執行
- 新增 API 時優先在既有檔案加 `action`，不要增加檔案（Vercel Hobby 方案有函式數量上限）

## Coding conventions

- JavaScript（ES2022+，ES modules）；不引入 TypeScript、前端框架或打包工具，除非擁有者同意
- 相依套件盡量少；新增任何 npm 套件前先說明理由（密碼雜湊與 HMAC 使用 Node 內建 `crypto`）
- 命名：變數 / 函式 `camelCase`，檔案 `kebab-case` 或與路由一致
- Notion 欄位名稱只能出現在 `api/_lib/template.js`；其他地方使用整理後的英文欄位（`name`、`status`、`rating`、`category`...）
- 手機優先 CSS：先寫手機樣式，再用 `min-width` 擴充；點擊區域至少 44×44px；需考慮單手操作
- 顯示 Notion 資料一律用 `textContent`，不要用 `innerHTML` 插入資料（避免 XSS）；外部連結加 `rel="noopener noreferrer"`
- API 回應一律 JSON；錯誤格式 `{ "error": "訊息" }`，搭配正確 HTTP status code
- 註解精簡，只解釋「為什麼」
- UI 文字使用繁體中文

## Security rules

**最高優先：任何秘密資訊都不能進入 Git / GitHub。**

- 秘密只放在：
  - 本機：`.env.local`（被 `.gitignore` 排除）
  - 線上：Vercel 專案的 Environment Variables
- 環境變數：
  - `NOTION_TOKEN` — Notion Integration Token
  - `NOTION_REGISTRY_DATABASE_ID` — 「轉換紀錄」Database ID
  - `ADMIN_PASSWORD` — 轉換器管理密碼
  - `SESSION_SECRET` — cookie 簽章用的隨機長字串（至少 32 bytes）
- `.env.example` 只寫變數名稱與說明，值留空
- 絕對不要：
  - 把 Token、密碼、密鑰寫死在程式碼、註解、測試、文件或 commit message 中
  - 把 Token 或密碼雜湊傳到前端
  - 在 log 或錯誤訊息中印出秘密、密碼或完整的 Notion 回應
  - 儲存明碼密碼
- 每次 commit 前檢查 `git diff --staged`，確認沒有秘密資訊
- 若秘密不慎被 commit 或推上 GitHub：立即停止並告知擁有者，請擁有者**撤銷並重新產生**該秘密（Notion Token 到 Notion 重新產生；其他密碼 / 密鑰更換）。只刪除 commit 不夠
- Claude 不應要求擁有者把 Token 或密碼貼在對話中；請擁有者自行寫入 `.env.local` 與 Vercel

`.gitignore` 至少包含：

```
node_modules/
.env
.env.*
!.env.example
.vercel/
.DS_Store
```

## Git rules

- 預設分支 `main`，保持隨時可部署
- 新功能在分支上開發：`feat/<簡述>`、`fix/<簡述>`，完成後合併回 `main`
- Commit 訊息使用 Conventional Commits：`feat: 新增評分填寫`、`fix: ...`、`docs: ...`、`chore: ...`
- 小而聚焦的 commit；一個 commit 做一件事
- 只有在擁有者要求時才 commit / push；不 force push 到 `main`
- 第一個 commit 必須先包含 `.gitignore`，再加入其他檔案

## Development workflow

1. **一次性設定**（由擁有者操作，Claude 提供步驟）
   - Notion：建立 Internal Integration → 連接到「🛍️ 購物清單」與「⚙️ ShoppingList 系統設定」兩個頁面
   - Notion：「轉換紀錄」Database 已建立於「⚙️ ShoppingList 系統設定」頁面
   - 複製 `.env.example` 為 `.env.local` 並由擁有者填入真實值（不需要 `npm install`，專案沒有相依套件）
   - 在擁有者既有的 GitHub 帳號下建立 Repository `ShoppingList`（建議設為 Private）
   - 建立 Vercel 帳號（用 GitHub 帳號登入）
2. **本機開發**：`npm run dev` → http://localhost:3000（`scripts/dev.mjs` 讀取 `.env.local`，提供 `public/`、`api/*` 與 `/l/<slug>` rewrite）
3. **測試**：用 DevTools 手機模擬檢查版面；用一個測試用的清單 Database 驗證讀寫，避免誤改真實的行程清單
4. **提交**：檢查 diff → commit → push 到 GitHub
5. **部署**：GitHub Repository 連結 Vercel
   - push 到 `main` → 自動部署正式網址
   - 其他分支 / PR → 自動產生預覽網址
   - 環境變數在 Vercel Dashboard 設定（Production 與 Preview 都要設）

開發順序：模板驗證與讀取 API → 清單頁顯示 → 狀態 / 評分寫入 → 篩選 / 排序 / 搜尋 → 清單密碼與 cookie → 轉換器與轉換紀錄 → 管理密碼 → 部署。

## Important constraints

- **保持簡單**：個人與旅伴使用的工具，不要過度工程化；任何新增的抽象層、套件、服務都需要明確理由
- Notion 是唯一資料來源；網站不保存商品資料副本（`localStorage` 只存 UI 偏好，例如上次選的篩選 / 排序）
- 網站只能：更新既有商品的「狀態」與「評分」、新增商品（不含照片）
- 只支援符合模板的 Database；模板欄位若有變動，只更新 `api/_lib/template.js` 與本文件的模板表格
- 必須在手機瀏覽器（iOS Safari、Android Chrome）上好用：載入快、單手操作、字體夠大
- 尊重 Notion API 限速，不做輪詢
- 使用免費方案即可完成（Vercel Hobby、Notion Integration）
