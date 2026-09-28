# 🛍️ Travel Shopping List

[繁體中文](README.md) | **English**

Turn the shopping list you planned in Notion into a **mobile-friendly shopping website** in one click, and share it with your travel companions behind a password.  
In the store you can see what's still left to buy, tick items off, jot down how you liked them, and add items you want to buy — every change syncs straight back to your Notion database.

![Travel Shopping List](public/og-image.png)

> The UI and the Notion template are in Traditional Chinese.

## Features

- **Converter**: paste a Notion database URL → validate it against the template → set a list password → get a share link
- **Mobile list page**
  - Shows only items not yet bought (未購買) by default; switch to bought / all
  - Filter by category, where to buy (Tag), who it's for and priority; sort by priority, price, name or brand; keyword search
  - One-tap "bought" toggle (with undo) and a rating / notes field, both written back to Notion
  - Add new items from your phone, and take or upload item photos directly (existing items too)
    - On Android the picker has no "take photo" option; take the photo with the camera app first, then choose it from the gallery
  - Tap-to-zoom photos, notes keep bold text and links, a button for the recommendation link, "Open in Notion"
  - A leading 【…】 in the item name is shown as the brand
  - Dark / light mode, install to home screen, switch between multiple lists
  - Link previews (thumbnail) when you share the URL
- **One password per list**, plus an admin password for the converter so only you can create and manage share links
- **No database server**: items and the link registry live in your own Notion
- **Free**: runs on the Vercel Hobby plan and a free Notion workspace

## How it works

```
Phone browser ──▶ Vercel serverless API (holds the Notion token & passwords) ──▶ Notion API
                                                                         ├─ one "購物清單" database per trip
                                                                         └─ "轉換紀錄" registry database
```

Everyone deploys **their own copy** with **their own** Notion integration, so data is never shared between users.

## Getting started (~15 minutes)

### 1. Duplicate the Notion template

Open the [Travel Shopping List template](https://about-travel.notion.site/Travel-Shopping-List-Template-b50c74f1eb1c8356b81f01a9bb2ae0fd) and click **Duplicate** to copy it into your workspace.
It contains two databases:

- **購物清單** (shopping list): duplicate it for each trip
- **轉換紀錄** (registry): managed by the website — leave it empty

> ⚠️ Don't rename properties or change their types; the website depends on them. You can freely add or edit options (e.g. Tag locations, "需要的人").

### 2. Create a Notion integration

1. Go to <https://www.notion.so/profile/integrations> and click **New integration**
2. Choose type **Internal** and the workspace where you duplicated the template
3. Under **Capabilities**, enable Read content, Update content and Insert content
4. Copy the **Internal Integration Secret** (starts with `ntn_`) — this is your `NOTION_TOKEN`
5. Open the duplicated template page, click **⋯ → Connections** and add the integration

> Lists you later duplicate inside this page inherit the access automatically.

### 3. Find the registry database ID

Open the "轉換紀錄" database as a full page and copy its URL. The 32-character string before `?` is the database ID:

```
https://www.notion.so/xxxx/0123456789abcdef0123456789abcdef?v=...
                           └──────── database ID ─────────┘
```

### 4. Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fluyachien%2FShoppingList&project-name=shopping-list&repository-name=shopping-list&env=NOTION_TOKEN%2CNOTION_REGISTRY_DATABASE_ID%2CADMIN_PASSWORD%2CSESSION_SECRET&envDescription=Notion%20token%2C%20registry%20database%20ID%2C%20admin%20password%20and%20a%20random%20session%20secret&envLink=https%3A%2F%2Fgithub.com%2Fluyachien%2FShoppingList%2Fblob%2Fmain%2FREADME.en.md%23environment-variables)

Click the button (you can sign up for Vercel with your GitHub account), fill in the environment variables below and deploy.

#### Environment variables

| Name | Description |
|---|---|
| `NOTION_TOKEN` | The integration secret from step 2 |
| `NOTION_REGISTRY_DATABASE_ID` | The "轉換紀錄" database ID from step 3 |
| `ADMIN_PASSWORD` | Password for the converter — keep it to yourself |
| `SESSION_SECRET` | A random string of at least 32 characters used to sign logins |

Generate `SESSION_SECRET` with either of:

```bash
openssl rand -hex 32
# or
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> 🔒 These values live only in Vercel's environment variables. **Never** put them in code or commit them to Git.

### 5. Convert your first list

1. Open your Vercel URL (e.g. `https://shopping-list-xxxx.vercel.app`) and enter the admin password
2. Paste the URL of a "購物清單" database and click **"轉換"** (convert)
3. Set a password for the list and click **"建立分享網址"** (create share link)
4. Send the link and password to your travel companions

## User guides

Step-by-step guides with screenshots for every feature (hosted on Notion):

- 📱 [Mobile Shopping List — User Guide](https://about-travel.notion.site/Mobile-Shopping-List-User-Guide-0e2c74f1eb1c82ff9763011a49504df1): for companions and yourself — viewing the list, filtering and search, marking items as bought, reviews, adding items and photos, installing to the home screen
- ⚙️ [Shopping List Converter — Owner's Guide](https://about-travel.notion.site/Shopping-List-Converter-Owner-s-Guide-795c74f1eb1c8345b5798130356926bf): for the list owner — converting a Notion database, setting passwords, sharing links, disabling lists

中文版：[手機購物清單使用教學](https://about-travel.notion.site/ccdc74f1eb1c83f1b07c01d0e611137b) · [購物清單轉換器使用教學](https://about-travel.notion.site/6e9c74f1eb1c8231b757016180a0d340)

## FAQ

**1. "Database not found" when converting?**  
Make sure the page containing the database (or a parent page) has your integration added under **⋯ → Connections**.

**2. Missing properties or wrong types?**  
Only the template structure is supported. Required properties are "商品名稱", "狀態", "評分" and "種類", and "狀態" must have the options "未購買" and "已購買".

**3. Installing on iPhone?**  
Open the list in Safari → Share → **Add to Home Screen**. The home-screen app doesn't share logins with Safari, so enter the list password once more the first time.

**4. No preview image when sharing?**  
Apps like LINE and Messenger cache previews. Add a parameter such as `?v=2` to the URL and send it again.

**5. What can someone with the share link do?**  
Nothing without the list password.  
The website only changes "狀態" (bought) and "評分" (rating) and can add new items; it never deletes anything.  
Whether "Open in Notion" shows anything depends on Notion permissions; if the database is published to the web in Notion, anyone can view it read-only.

## Local development

Requires Node.js 22+. There are no npm dependencies.

```bash
cp .env.example .env.local   # fill in the variables above
npm run dev                  # http://localhost:3000
```

Key files:

| Path | Purpose |
|---|---|
| `api/admin.js` | Converter and list management API |
| `api/list.js` | List page, login, read / add / update items |
| `api/_lib/template.js` | Notion template definition (the only place property names appear) |
| `public/` | Front end (plain HTML / CSS / JavaScript, no bundler) |
| `scripts/dev.mjs` | Local server that mimics Vercel routing |

## License

[MIT](LICENSE)
