# Bugreport Extractor Web — AI Agent 維護與開發指南

本文件專為協同開發、維護或重構本專案的 **AI Agent** 設計。  
本專案為部署於 **GitHub Pages** 的純前端靜態站點，核心任務是在瀏覽器本地快速將 150MB~200MB 的 Android Bugreport 巨型文字檔萃取為相容於 Gemini 上下文窗口（約 3MB）的 `gemini_perf_dump.txt`。

---

## 一、 專案架構與職責邊界

本專案堅持「零構建、零後端、零相依（Zero-build, Zero-backend, Zero-dependency）」原則：

```
📁 bugreport-extractor-web/
├── 📄 index.html      # 靜態 HTML5 骨架，定義上傳區、檔案狀態卡片、進度條與下載卡片
├── 📄 style.css       # 現代深色質感樣式，負責拖曳動畫、進度條動態與響應式排版
├── 📄 app.js          # 核心解析引擎：4MB 分塊串流讀取、行緩衝區重組、狀態機過濾、Blob 生成
├── 📄 README.md       # 面向人類使用者的中文說明書與 GitHub Pages 部署指引
└── 📄 AGENTS.md       # 本手冊：面向 AI Agent 的系統架構與維護規範
```

---

## 二、 核心架構約束（AI Agent 必須嚴格遵守）

任何 AI Agent 在修改本專案程式碼時，**嚴禁違反以下四項核心約束**：

1. **純靜態架構（Static Only）**：
   * 本專案必須能夠在 GitHub Pages、本機 `file:///` 協議或任何靜態 Web 伺服器上直接執行。
   * **嚴禁引入 Node.js / Python / Go 後端服務**，嚴禁依賴 Webpack / Vite / npm build 步驟。
2. **極致隱私保護（Strict Privacy & No Log Render）**：
   * 使用者明確要求：**上傳後絕不可在 DOM 中渲染或預覽原始檔案內容**。
   * 畫面上僅允許展示檔案名稱（`file.name`）與檔案大小（`file.size`）。
   * 處理完畢後，**僅顯示「處理成功」與「下載按鈕」**，不展示抽取後的日誌文字。
3. **記憶體防禦（Stream-first & Low Memory Footprint）**：
   * 原始檔案體積常在 150MB~500MB，**嚴禁使用 `file.text()` 一次性將全文讀入記憶體**。
   * 必須維持 `file.slice()` 分塊串流機制（預設 Chunk Size: 4MB），記憶體開銷須恆定控制在 25MB 以內。
4. **輸出體積約束（Gemini Token Compatibility）**：
   * 萃取產物 `gemini_perf_dump.txt` 的體積上限應嚴格維持在 **1MB ~ 5MB** 之間（約 25 萬 ~ 120 萬 Token），以確保能被 Gemini 1.5 Pro / 2.0 Pro 的上下文視窗無損容納。

---

## 三、 串流解析演算法與狀態機設計 (`app.js`)

解析器採用 **Chunked Slicing + Line Buffer Reassembly + Section State Machine** 模型：

### 1. 行緩衝區重組邏輯
由於 4MB 切片可能正好截斷在某行文字中間，解析器維護 `leftoverLine`：
```javascript
const text = leftoverLine + chunkString;
const lines = text.split('\n');
leftoverLine = lines.pop(); // 未完成的行留至下一個 chunk 拼接
```

### 2. 狀態機核心變數
* `lineIndex`：全域行數計算器。前 100 行無條件保留（取得硬體型號與系統 Build 資訊）。
* `currentService`：當前進入的 `DUMP OF SERVICE [LEVEL] <name>:` 服務名稱。
* `currentServiceLines`：該服務已讀取行數計數器。
* `inDexopt`：布林值，標記是否正處於 `package` 服務中的 `Dexopt state:` 子區塊。
* `inEventLog`：布林值，標記是否正處於 `EVENT LOG` 區段。
* `inMemInfoProc`：布林值，標記是否正處於 `/proc/meminfo` 區段。

### 3. 各服務截取策略表
* **全量保留組**（體積小於 5,000 行，完整保留）：
  * `cpuinfo`, `graphicsstats`, `thermalservice`, `storaged`, `usagestats`
* **定量截取精華組**（總行數多，但精華集中於前段）：
  * `meminfo`：取前 1,500 行（涵蓋 Total PSS, ZRAM, ION_heap 與排行）。
  * `procstats`：取前 2,000 行（涵蓋行程 PSS 與歷史運行時間百分比）。
  * `SurfaceFlinger`：取前 1,000 行（涵蓋顯示模式、螢幕更新率）。
  * `batterystats`：取前 2,000 行，並排除微觀時間戳行（`!line.startsWith('  +')`）。
* **條件正則過濾組**：
  * `package`：僅擷取 `Dexopt state:` 開頭直到下一個大寫屬性，過濾 14 萬行冗餘。
  * `settings`：僅擷取包含 `enabled_accessibility_services` 與 `refresh_rate` 的配置。
  * `EVENT LOG`：僅保留包含 `am_anr`, `am_crash`, `am_kill` 之崩潰與殺行程記錄。

---

## 四、 如何擴充或調整萃取規則

若日後需要針對新的 Android 版本或特定模組新增擷取標的：

1. **新增全量服務**：
   在 `app.js` 的 `fullDumpServices` Set 中加入該服務名稱（對應 `dumpsys <service>` 之標頭名稱）。
2. **新增子區塊正則**：
   在 `processLine(line)` 中針對 `currentService` 添加特定條件判斷。
3. **驗證產出大小**：
   修改後務必使用 160MB 實測日誌進行驗證，確保輸出之 `gemini_perf_dump.txt` 體積維持在 1.5MB~4.5MB 區間。

---

## 五、 本地測試驗證步驟

Agent 在進行代碼重構或功能更新後，可透過下列命令驗證：
```powershell
# 進入靜態網頁目錄
cd D:\Documents\FlshPhone\log\bugreport-extractor-web

# 啟動輕量靜態測試伺服器（可選，直接雙擊 index.html 亦可測試）
npx serve .
```
驗證檢核清單：
- [ ] 拖入 160MB 檔案，檔案名稱與大小正確呈現，畫面未洩漏日誌內容。
- [ ] 進度條平滑自 0% 跑至 100%，耗時小於 3 秒，分頁無未回應現象。
- [ ] 顯示「處理成功！」卡片。
- [ ] 點擊「下載 gemini_perf_dump.txt」，下載檔案大小介於 2MB~5MB 之間，以文字編輯器打開可見正確之系統標頭、Dexopt 與各核心 Dumpsys。
