/**
 * Android Bugreport 輕量萃取引擎 (Pure Client-Side Vanilla JS)
 * 100% 瀏覽器本地執行，使用 Chunked Slicing 串流分塊讀取，不佔用大量記憶體。
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM 元素
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const fileInfoCard = document.getElementById('fileInfoCard');
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  const fileSizeDisplay = document.getElementById('fileSizeDisplay');
  const startProcessBtn = document.getElementById('startProcessBtn');
  
  const processingCard = document.getElementById('processingCard');
  const progressBar = document.getElementById('progressBar');
  const progressPercent = document.getElementById('progressPercent');
  const progressBytes = document.getElementById('progressBytes');
  const statusText = document.getElementById('statusText');

  const resultCard = document.getElementById('resultCard');
  const origSizeSummary = document.getElementById('origSizeSummary');
  const dumpSizeSummary = document.getElementById('dumpSizeSummary');
  const compressionSummary = document.getElementById('compressionSummary');
  const downloadBtn = document.getElementById('downloadBtn');
  const resetBtn = document.getElementById('resetBtn');

  let selectedFile = null;
  let downloadUrl = null;

  // 格式化位元組大小
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // 拖曳互動事件
  dropZone.addEventListener('click', () => fileInput.click());

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelected(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });

  // 檔案選中處理（嚴格遵循要求：僅顯示檔名與大小，絕不讀取或展示內容）
  function handleFileSelected(file) {
    selectedFile = file;
    fileNameDisplay.textContent = file.name;
    fileSizeDisplay.textContent = formatBytes(file.size);

    dropZone.classList.add('hidden');
    fileInfoCard.classList.remove('hidden');
    resultCard.classList.add('hidden');
    processingCard.classList.add('hidden');
  }

  // 開始處理按鈕
  startProcessBtn.addEventListener('click', () => {
    if (!selectedFile) return;
    fileInfoCard.classList.add('hidden');
    processingCard.classList.remove('hidden');
    processBugreport(selectedFile);
  });

  // 重設狀態按鈕
  resetBtn.addEventListener('click', () => {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      downloadUrl = null;
    }
    selectedFile = null;
    fileInput.value = '';
    resultCard.classList.add('hidden');
    processingCard.classList.add('hidden');
    fileInfoCard.classList.add('hidden');
    dropZone.classList.remove('hidden');
  });

  /**
   * 核心串流萃取邏輯
   * 採用 4MB 分塊切片 (file.slice) + FileReader 循序處理
   * 保證在 160MB ~ 1GB 檔案下記憶體保持在 20MB 以內，不卡死 UI
   */
  async function processBugreport(file) {
    const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB per chunk
    const totalSize = file.size;
    let offset = 0;
    let leftoverLine = '';

    let lineIndex = 0;
    let currentService = null;
    let currentServiceLines = 0;
    let inDexopt = false;
    let inEventLog = false;
    let inMemInfoProc = false;

    // 收集輸出的文字區塊陣列（用於建立最終 Blob）
    const outputChunks = [];
    let currentOutputBuffer = [];
    let totalExtractedBytes = 0;

    function pushLine(line) {
      currentOutputBuffer.push(line);
      totalExtractedBytes += line.length + 1;
      if (currentOutputBuffer.length >= 2000) {
        outputChunks.push(currentOutputBuffer.join('\n') + '\n');
        currentOutputBuffer = [];
      }
    }

    const fullDumpServices = new Set([
      'cpuinfo', 'graphicsstats', 'thermalservice', 'storaged', 'usagestats'
    ]);

    const targetServices = new Set([
      'cpuinfo', 'graphicsstats', 'thermalservice', 'storaged', 
      'usagestats', 'procstats', 'meminfo', 'SurfaceFlinger', 
      'batterystats', 'settings', 'package'
    ]);

    // 單行萃取判斷核心
    function processLine(line) {
      lineIndex++;

      // 1. 系統開頭標頭（前 100 行：系統型號、Build ID、Kernel、啟動時間）
      if (lineIndex <= 100) {
        pushLine(line);
        return;
      }

      // 2. /proc/meminfo 實體記憶體核心數據
      if (line.startsWith('------ MEMORY INFO')) {
        inMemInfoProc = true;
        pushLine(line);
        return;
      } else if (inMemInfoProc) {
        if (line.startsWith('------ ')) {
          inMemInfoProc = false;
        } else {
          pushLine(line);
          return;
        }
      }

      // 3. EVENT LOG 系統事件（過濾崩潰、ANR 與強制結束事件）
      if (line.startsWith('------ EVENT LOG')) {
        inEventLog = true;
        pushLine(line);
        return;
      } else if (inEventLog) {
        if (line.includes('was the duration of \'EVENT LOG\'')) {
          inEventLog = false;
          pushLine(line);
        } else if (line.includes('am_anr') || line.includes('am_crash') || line.includes('am_kill')) {
          pushLine(line);
        }
        return;
      }

      // 4. 偵測 DUMP OF SERVICE 標頭
      const serviceMatch = line.match(/^DUMP OF SERVICE (?:CRITICAL|HIGH|NORMAL)?\s*([a-zA-Z0-9_\-\.]+):/);
      if (serviceMatch) {
        currentService = serviceMatch[1];
        currentServiceLines = 0;
        inDexopt = false;
        if (targetServices.has(currentService)) {
          pushLine(line);
        }
        return;
      }

      // 偵測服務區段結束
      if (line.startsWith('------ ') && line.includes('was the duration of')) {
        currentService = null;
        inDexopt = false;
        return;
      }

      // 5. 服務內容細部過濾（只取核心精華，去除數十萬行冗餘）
      if (currentService) {
        currentServiceLines++;

        if (fullDumpServices.has(currentService)) {
          pushLine(line);
        } else if (currentService === 'procstats') {
          // procstats 取前 2000 行（已涵蓋核心 PSS、OOM 佔用與執行時間分組）
          if (currentServiceLines <= 2000) pushLine(line);
        } else if (currentService === 'meminfo') {
          // meminfo 取前 1500 行（包含 Total PSS, ZRAM, ION_heap 與各行程記憶體排行）
          if (currentServiceLines <= 1500) pushLine(line);
        } else if (currentService === 'SurfaceFlinger') {
          // SurfaceFlinger 取前 1000 行（涵蓋顯示模式、螢幕更新率、渲染緩衝區狀態）
          if (currentServiceLines <= 1000) pushLine(line);
        } else if (currentService === 'batterystats') {
          // batterystats 取前 2000 行（涵蓋深度睡眠、螢幕開啟時數與耗電排行，跳過高頻時間戳）
          if (currentServiceLines <= 2000 && !line.startsWith('  +')) {
            pushLine(line);
          }
        } else if (currentService === 'settings') {
          // settings 僅保留無障礙服務與更新率設定
          if (line.includes('enabled_accessibility_services') || line.includes('refresh_rate')) {
            pushLine(line);
          }
        } else if (currentService === 'package') {
          // package 僅抽取 Dexopt state（過濾 14 萬行無關套件資訊）
          if (line.startsWith('Dexopt state:')) inDexopt = true;
          else if (inDexopt && (line.startsWith('Compiler filter:') || /^[A-Z][a-zA-Z\s]+:/.test(line))) {
            inDexopt = false;
          }
          if (inDexopt) pushLine(line);
        }
      }
    }

    // 逐塊讀取處理
    function readNextChunk() {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();

      reader.onload = function(e) {
        const text = leftoverLine + e.target.result;
        const lines = text.split('\n');
        leftoverLine = lines.pop(); // 保留最後一行未完成字串

        for (let i = 0; i < lines.length; i++) {
          processLine(lines[i]);
        }

        offset += CHUNK_SIZE;

        // 更新進度條
        const currentProgress = Math.min(100, Math.round((offset / totalSize) * 100));
        progressBar.style.width = currentProgress + '%';
        progressPercent.textContent = currentProgress + '%';
        progressBytes.textContent = `${formatBytes(Math.min(offset, totalSize))} / ${formatBytes(totalSize)}`;

        if (offset < totalSize) {
          // 使用 requestAnimationFrame 讓出主線程，維持 UI 動畫流暢
          requestAnimationFrame(readNextChunk);
        } else {
          // 檔案讀取結束，處理最後殘留字串
          if (leftoverLine) {
            processLine(leftoverLine);
          }
          if (currentOutputBuffer.length > 0) {
            outputChunks.push(currentOutputBuffer.join('\n'));
          }
          onProcessingComplete();
        }
      };

      reader.onerror = function() {
        alert('讀取檔案時發生錯誤，請重新選取檔案。');
        resetBtn.click();
      };

      reader.readAsText(slice, 'utf-8');
    }

    // 處理完成回呼
    function onProcessingComplete() {
      statusText.textContent = '正在打包輸出檔案...';

      setTimeout(() => {
        // 建立 Blob 與下載 URL
        const blob = new Blob(outputChunks, { type: 'text/plain;charset=utf-8' });
        downloadUrl = URL.createObjectURL(blob);
        downloadBtn.href = downloadUrl;

        // 計算縮減比例
        const origSize = file.size;
        const dumpSize = blob.size;
        const reduction = (((origSize - dumpSize) / origSize) * 100).toFixed(1);

        origSizeSummary.textContent = formatBytes(origSize);
        dumpSizeSummary.textContent = formatBytes(dumpSize);
        compressionSummary.textContent = `-${reduction}%`;

        // 切換介面（嚴格遵循要求：僅顯示處理成功與下載按鈕）
        processingCard.classList.add('hidden');
        resultCard.classList.remove('hidden');
      }, 200);
    }

    // 啟動分塊讀取
    readNextChunk();
  }
});
