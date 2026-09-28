# Android Bugreport 輕量萃取工具 (for Gemini)

> 一個 100% 純前端、零伺服器依賴的靜態網頁工具，可直接部署於 **GitHub Pages**。  
> 專為解決 Android 系統巨型 Bugreport（150MB~200MB+）無法直接上傳至 **Gemini 網頁端** 進行效能分析的痛點。

---

## 一、 為什麼需要這套工具？

當手機發生卡頓、掉幀、異常發熱或耗電時，透過 Android 系統產生的 Bugreport 往往高達 **150MB~200MB**（超過 150 萬行日誌）。

* **Gemini 網頁端的限制**：
  * 單一檔案上傳體積與純文字大小受限（常出現「檔案過大」拒收）。
  * 即使是頂級的 Gemini 1.5 Pro / 2.0 Pro（100 萬～200 萬 Token 上限），160MB 的純文字日誌相當於 **4,000 萬～5,000 萬 Token**，已大幅超出模型上下文視窗。
* **解決方案**：
  * 事實上，排查系統效能與耗電瓶頸**只需佔全日誌不到 3% 的核心服務章節**（如 CPU 佔用、記憶體/ZRAM、掉幀率、溫控狀態、Dexopt 編譯與背景 I/O）。
  * 本工具在瀏覽器端即時將 160MB 壓縮萃取為 **約 3MB 的 `gemini_perf_dump.txt`**（約 90 萬 Token），可直接拖進 Gemini 聊天視窗完成滿血深度診斷。

---

## 二、 核心特色

1. **100% 本地安全，隱私零洩漏**：
   * 採用 HTML5 `FileReader` 與分塊串流切片（Chunked Slicing）技術，所有日誌處理皆在您本機瀏覽器沙盒中完成。
   * **絕無任何網路請求與後端伺服器**，不需擔心個人日誌、套件清單或裝置隱私外洩。
2. **極致輕量與流暢**：
   * 以 4MB 分塊串流循序解析，記憶體佔用恆定在 20MB 以內，即使讀取 500MB+ 的超巨型文字檔亦不會造成瀏覽器分頁卡頓或崩潰。
3. **極簡操作體驗**：
   * 上傳時**不顯示日誌內容**，僅提示已選擇之檔案名稱與檔案大小。
   * 解析完畢後**僅顯示「處理成功」與清晰的「下載按鈕」**，一鍵下載 `gemini_perf_dump.txt`。
4. **零環境依賴**：
   * 無需安裝 Node.js、Python、npm 或任何編譯環境，雙擊 `index.html` 即開即用。

---

## 三、 萃取之核心服務與指標對照表

本工具會自原始 Bugreport 中自動萃取下列關鍵模組，並剔除無效的封包與高頻日誌冗餘：

| 服務模組 (Service) | 萃取內容與過濾規則 | 診斷用途 |
| :--- | :--- | :--- |
| **System Info & Build** | 檔案開頭前 100 行 | 讀取 Android 版本、Build ID、核心版本、開機時間 |
| **`/proc/meminfo`** | 完整記憶體狀態 | 診斷實體 RAM 剩餘量、ZRAM 置換區使用率（如 89% 飽和） |
| **`cpuinfo`** | 完整 CPU 服務傾印 | 診斷 Load Average、各 App 背景 CPU 佔用率與 Major Faults |
| **`graphicsstats`** | 完整圖形渲染統計 | 計算各 App 掉幀率（Janky Frames）、幀耗時與高輸入延遲次數 |
| **`thermalservice`** | 完整溫控感測狀態 | 檢測 CPU 大核溫度、SoC 溫度與溫控降頻等級（Status 0~3） |
| **`storaged`** | 完整儲存 I/O 統計 | 排查各 App 在背景的高頻磁碟讀取與寫入湧浪 |
| **`usagestats`** | 完整待機分組狀態 | 查看偷跑 App 的 Standby Bucket（如仍停留在 ACTIVE=10） |
| **`meminfo`** | 前 1,500 行精華 | Total PSS 排行、ION_heap 圖形緩衝區、各 OOM 級別記憶體 |
| **`procstats`** | 前 2,000 行精華 | 長期進程常駐時間、PSS 佔用中位數與峰值 |
| **`SurfaceFlinger`** | 前 1,000 行精華 | 當前螢幕解析度（如 QHD+ vs FHD+）、刷新率配置 |
| **`batterystats`** | 精選統計指標 | 深度睡眠時長、螢幕亮屏時間、更新率運作歷史 |
| **`package`** | **僅取 `Dexopt state:`** | 過濾 14 萬行無關套件，精確抓出 App 是否處於 `verify` 未編譯 |
| **`settings`** | **僅取無障礙與更新率** | 檢測 `enabled_accessibility_services`（抓出攔截觸控之元兇） |
| **`EVENT LOG`** | **僅取關鍵系統事件** | 擷取 `am_anr`、`am_crash` 與進程被殺 `am_kill` 事件 |

---

## 四、 GitHub Pages 部署教學（3 分鐘完成）

本專案完全符合 GitHub Pages 靜態網站託管規範，部署步驟如下：

### 步驟 1：建立 GitHub 儲存庫
1. 登入 GitHub，點擊右上角 **「New repository」**。
2. 設定 Repository 名稱（例如：`bugreport-extractor`），設定為 **Public**。
3. 點擊 **「Create repository」**。

### 步驟 2：將本專案檔案推送至 GitHub
在本地終端機（PowerShell 或 Bash）進入本資料夾目錄：
```bash
git init
git add .
git commit -m "feat: initial commit for bugreport extractor static web"
git branch -M main
git remote add origin https://github.com/<您的GitHub帳號>/<儲存庫名稱>.git
git push -u origin main
```

### 步驟 3：開啟 GitHub Pages 服務
1. 進入該 GitHub 儲存庫頁面，點選頂部 **「Settings」**。
2. 在左側選單點選 **「Pages」**。
3. 在 **「Build and deployment」** 下方的 **Branch** 選擇 `main` 分支，資料夾保持 `/ (root)`。
4. 點擊 **「Save」**。

約 1~2 分鐘後，即可在該頁面頂部取得專屬靜態網站網址：  
👉 `https://<您的GitHub帳號>.github.io/<儲存庫名稱>/`

---

## 五、 本地離線使用方式

若暫時不需要部署到網路上，直接在本地電腦使用亦可：
1. 進入本資料夾。
2. 雙擊 **[`index.html`](file:///D:/Documents/FlshPhone/log/bugreport-extractor-web/index.html)** 檔案。
3. 檔案將自動在您預設的瀏覽器（Chrome、Edge、Safari、Firefox）開啟。
4. 將您的 `bugreport-*.txt` 拖入視窗，即可秒速完成萃取！

---

## 六、 搭配 Gemini 分析之建議操作 SOP

1. 在本網頁中上傳 `bugreport-*.txt`，點擊「開始萃取精華」，下載產出的 **`gemini_perf_dump.txt`**。
2. 開啟 **[Gemini (gemini.google.com)](https://gemini.google.com/)** 聊天視窗。
3. 同時拖入以下 3 個輕量檔案：
   - 📄 **`gemini_perf_dump.txt`**（由本工具產出，約 3MB）
   - 📄 **`dumpstate_board.txt`**（Bugreport 資料夾內原有檔案，約 1.8MB）
   - 📄 **`FS/data/anr/anr_*`**（Bugreport 資料夾內的當機堆疊追蹤檔，若有）
4. 在 Gemini 聊天框貼上以下 Prompt：
   ```text
   請根據上傳的 Android Bugreport 核心日誌（gemini_perf_dump.txt、dumpstate_board.txt 與 ANR 追蹤檔），為我進行深度的整機系統效能診斷與流暢度排查：
   1. 列出「核心數據指標儀表板」（無障礙服務、輸入延遲、CPU負載、記憶體/ZRAM飽和度、核心溫度與溫控降頻狀態、掉幀率等）。
   2. 深入剖析導致手機卡頓、掉幀或耗電的核心病灶（需包含底層機制原理、日誌數據實證與使用者體感影響）。
   3. 產出分級的 ADB 無 Root 優化執行計畫（包含 AOT 編譯、待機分組管制、非必要組件停用與一鍵復原指令）。
   ```
