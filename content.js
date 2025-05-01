// Global variables
let subtitles = [];
let currentSubtitle = null;
let displayedSubtitles = [];  // Store history of displayed subtitles
let subtitleElement = null;
let subtitleModal = null;
let checkInterval = null;
let videoElement = null;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let initialX = 0;
let initialY = 0;
let isResizing = false;
let initialWidth = 0;
let initialHeight = 0;
let resizeDirection = ''; // 记录当前调整大小的方向
let autoScroll = true;  // Flag to control auto-scrolling
let enableTranslation = true; // 是否启用翻译
let translationCache = {}; // 缓存翻译结果
let translationQueue = [];
let isTranslating = false;
let prioritySubtitle = null;

// Listen for messages from the popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'applySubtitles') {
    try {
      // Get subtitles from the message
      subtitles = request.subtitles;
      
      // Reset displayed subtitles history
      displayedSubtitles = [];
      
      // Clear translation cache
      translationCache = {};
      
      // Find video element on the page
      videoElement = findVideoElement();
      
      if (!videoElement) {
        sendResponse({success: false, error: 'No video element found on this page.'});
        return true;
      }
      
      // Create or reset subtitle display element
      setupSubtitleModal();
      
      // 立即加载并显示所有字幕
      loadAllSubtitles();
      
      // Start checking for subtitle updates
      startSubtitleTracking();
      
      sendResponse({success: true});
    } catch (error) {
      sendResponse({success: false, error: error.message});
    }
    return true;
  } else if (request.action === 'toggleTranslation') {
    // 切换翻译状态
    enableTranslation = request.enable;
    // 清空现有字幕并重新加载，应用新设置
    displayedSubtitles = [];
    loadAllSubtitles();
    sendResponse({success: true});
    return true;
  }
});

// Function to find the main video element on the page
function findVideoElement() {
  // Try to find the largest video element on the page (most likely the main content)
  const videos = document.querySelectorAll('video');
  
  if (videos.length === 0) {
    return null;
  }
  
  if (videos.length === 1) {
    return videos[0];
  }
  
  // If multiple videos, find the largest one that's visible
  let largestVideo = null;
  let largestArea = 0;
  
  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    const area = rect.width * rect.height;
    
    if (area > largestArea && isElementVisible(video)) {
      largestArea = area;
      largestVideo = video;
    }
  }
  
  return largestVideo;
}

// Function to check if an element is visible
function isElementVisible(element) {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null;
}

// Function to set up the subtitle modal
function setupSubtitleModal() {
  // Remove existing subtitle element if it exists
  if (subtitleModal) {
    subtitleModal.remove();
  }
  
  // Create modal container
  subtitleModal = document.createElement('div');
  subtitleModal.id = 'srt-subtitle-modal';
  
  // 添加文本高亮样式
  const style = document.createElement('style');
  style.textContent = `
    .highlight-text {
      color: #ffcc00 !important;
      font-weight: bold;
    }
    .current-subtitle {
      /* 保留类名但移除视觉效果 */
    }
    /* 添加resize handles样式 */
    .resize-handle {
      position: absolute;
      background: transparent;
      z-index: 1000;
    }
    .resize-n {
      top: -3px;
      left: 0;
      width: 100%;
      height: 6px;
      cursor: ns-resize;
    }
    .resize-e {
      top: 0;
      right: -3px;
      width: 6px;
      height: 100%;
      cursor: ew-resize;
    }
    .resize-s {
      bottom: -3px;
      left: 0;
      width: 100%;
      height: 6px;
      cursor: ns-resize;
    }
    .resize-w {
      top: 0;
      left: -3px;
      width: 6px;
      height: 100%;
      cursor: ew-resize;
    }
    .resize-ne {
      top: -3px;
      right: -3px;
      width: 12px;
      height: 12px;
      cursor: nesw-resize;
    }
    .resize-se {
      bottom: -3px;
      right: -3px;
      width: 12px;
      height: 12px;
      cursor: nwse-resize;
    }
    .resize-sw {
      bottom: -3px;
      left: -3px;
      width: 12px;
      height: 12px;
      cursor: nesw-resize;
    }
    .resize-nw {
      top: -3px;
      left: -3px;
      width: 12px;
      height: 12px;
      cursor: nwse-resize;
    }
  `;
  document.head.appendChild(style);
  
  // Create header for dragging
  const modalHeader = document.createElement('div');
  modalHeader.id = 'srt-modal-header';
  
  // 添加翻译开关
  const translationToggle = document.createElement('div');
  translationToggle.id = 'translation-toggle';
  translationToggle.innerHTML = `
    <label class="toggle-switch">
      <input type="checkbox" ${enableTranslation ? 'checked' : ''} id="translation-checkbox">
      <span class="toggle-slider"></span>
    </label>
    <span>启用翻译</span>
  `;
  
  modalHeader.innerHTML = '<span>字幕 (拖动移动)</span>';
  modalHeader.appendChild(translationToggle);
  subtitleModal.appendChild(modalHeader);
  
  // Create subtitle content container with scrolling
  const subtitleScrollContainer = document.createElement('div');
  subtitleScrollContainer.id = 'srt-subtitle-scroll-container';
  subtitleModal.appendChild(subtitleScrollContainer);
  
  // Create subtitle content element
  subtitleElement = document.createElement('div');
  subtitleElement.id = 'srt-subtitle-content';
  subtitleScrollContainer.appendChild(subtitleElement);
  
  // 创建8个方向的调整大小手柄
  const directions = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'];
  
  directions.forEach(dir => {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-${dir}`;
    handle.dataset.direction = dir;
    subtitleModal.appendChild(handle);
    
    // Add event listener for each handle
    handle.addEventListener('mousedown', startResize);
  });
  
  // Add to body
  document.body.appendChild(subtitleModal);
  
  // 优化初始位置和大小
  const videoRect = videoElement.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // 计算合适的宽度和位置
  const optimalWidth = Math.min(videoRect.width, 500); // 限制最大宽度500px
  const optimalLeft = Math.max(10, videoRect.left + (videoRect.width - optimalWidth) / 2); // 水平居中对齐视频
  
  // 设置模态框位置和大小
  subtitleModal.style.left = `${optimalLeft}px`;
  subtitleModal.style.top = `${videoRect.bottom + 10}px`; // 仍然在视频下方10px
  subtitleModal.style.width = `${optimalWidth}px`;
  subtitleModal.style.height = '300px';
  subtitleModal.style.display = 'block';
  
  // Add event listeners for dragging
  modalHeader.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', stopDrag);
  
  // Add event listeners for resizing
  document.addEventListener('mousemove', resize);
  document.addEventListener('mouseup', stopResize);
  
  // 默认启用自动滚动
  autoScroll = true;
  
  // 添加手动滚动事件
  subtitleScrollContainer.addEventListener('wheel', () => {
    autoScroll = false;
    // 5秒后恢复自动滚动
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      // 只有当鼠标不在容器上时才恢复自动滚动
      if (!isHovering) {
        autoScroll = true;
        if (currentSubtitle) {
          const currentEntry = document.querySelector('.current-subtitle');
          if (currentEntry) {
            scrollToSubtitle(currentEntry);
          }
        }
      }
    }, 5000);
  });
  
  // 添加变量跟踪鼠标悬停状态
  let isHovering = false;
  let scrollTimeout;
  
  // 更新鼠标进入/离开事件来维护悬停状态
  subtitleScrollContainer.addEventListener('mouseenter', () => {
    isHovering = true;
    autoScroll = false;
  });
  
  subtitleScrollContainer.addEventListener('mouseleave', () => {
    isHovering = false;
    autoScroll = true;
    
    // 恢复自动滚动时，如果有当前字幕，立即滚动到该位置
    if (currentSubtitle) {
      const currentEntry = document.querySelector('.current-subtitle');
      if (currentEntry) {
        scrollToSubtitle(currentEntry);
      }
    }
  });
  
  // 翻译开关事件监听
  const checkbox = document.getElementById('translation-checkbox');
  if (checkbox) {
    checkbox.addEventListener('change', function() {
      enableTranslation = this.checked;
      // 重新加载所有字幕，应用新设置
      loadAllSubtitles();
    });
  }
}

// 新增函数：预加载并显示所有字幕
async function loadAllSubtitles() {
  if (!subtitles || subtitles.length === 0) return;
  
  // 按时间顺序排序字幕
  subtitles.sort((a, b) => a.startTime - b.startTime);
  
  // 首先添加所有字幕到显示列表（不带翻译）
  displayedSubtitles = [...subtitles.map(subtitle => ({...subtitle}))];
  
  // 立即更新显示（先显示原文）
  updateSubtitleDisplay();
  
  // 不再在这里翻译所有字幕，而是等待播放触发翻译
  
  // 显示模态框
  subtitleModal.style.display = 'block';
}

// Drag functionality
function startDrag(e) {
  // 不要在点击翻译开关时启动拖动
  if (e.target.id === 'translation-checkbox' || 
      e.target.classList.contains('toggle-slider') ||
      e.target.closest('#translation-toggle')) {
    return;
  }
  
  if (!isDragging) {
    isDragging = true;
    initialX = subtitleModal.offsetLeft;
    initialY = subtitleModal.offsetTop;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    
    // Prevent text selection during drag
    e.preventDefault();
  }
}

function drag(e) {
  if (isDragging) {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    
    subtitleModal.style.left = `${initialX + dx}px`;
    subtitleModal.style.top = `${initialY + dy}px`;
  }
}

function stopDrag() {
  isDragging = false;
}

// Resize functionality
function startResize(e) {
  if (!isResizing) {
    isResizing = true;
    // 记录调整方向
    resizeDirection = e.target.dataset.direction || 'se';
    
    initialWidth = subtitleModal.offsetWidth;
    initialHeight = subtitleModal.offsetHeight;
    initialX = subtitleModal.offsetLeft;
    initialY = subtitleModal.offsetTop;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    
    // Prevent text selection during resize
    e.preventDefault();
  }
}

function resize(e) {
  if (isResizing) {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    
    let newWidth = initialWidth;
    let newHeight = initialHeight;
    let newLeft = initialX;
    let newTop = initialY;
    
    // 根据调整方向应用相应的变化
    if (resizeDirection.includes('e')) {
      newWidth = initialWidth + dx;
    }
    if (resizeDirection.includes('s')) {
      newHeight = initialHeight + dy;
    }
    if (resizeDirection.includes('w')) {
      newWidth = initialWidth - dx;
      newLeft = initialX + dx;
    }
    if (resizeDirection.includes('n')) {
      newHeight = initialHeight - dy;
      newTop = initialY + dy;
    }
    
    // 设置最小尺寸
    const minWidth = 200;
    const minHeight = 100;
    
    if (newWidth >= minWidth) {
      subtitleModal.style.width = `${newWidth}px`;
      if (resizeDirection.includes('w')) {
        subtitleModal.style.left = `${newLeft}px`;
      }
    }
    
    if (newHeight >= minHeight) {
      subtitleModal.style.height = `${newHeight}px`;
      if (resizeDirection.includes('n')) {
        subtitleModal.style.top = `${newTop}px`;
      }
    }
  }
}

function stopResize() {
  isResizing = false;
  resizeDirection = '';
}

// Function to start tracking and displaying subtitles
function startSubtitleTracking() {
  // Clear existing interval if it exists
  if (checkInterval) {
    clearInterval(checkInterval);
  }
  
  // Check for subtitle updates every 100ms
  checkInterval = setInterval(updateSubtitle, 100);
  
  // Add event listener for video play/pause
  videoElement.addEventListener('play', () => {
    if (checkInterval === null) {
      checkInterval = setInterval(updateSubtitle, 100);
    }
  });
  
  videoElement.addEventListener('pause', () => {
    if (checkInterval !== null) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  });
  
  videoElement.addEventListener('ended', () => {
    if (checkInterval !== null) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  });
}

// Function to update the subtitle based on current video time
function updateSubtitle() {
  if (!videoElement || !subtitleElement || subtitles.length === 0) return;
  
  const currentTime = videoElement.currentTime * 1000; // Convert to ms
  
  // 找到当前时间对应的字幕
  const subtitle = findSubtitleForTime(currentTime);
  
  // 如果找到了新的当前字幕
  if (subtitle && subtitle !== currentSubtitle) {
    // 更新当前字幕
    currentSubtitle = subtitle;
    
    // 移除所有字幕的高亮标记
    removeAllHighlights();
    
    // 为当前播放的字幕添加高亮标记并滚动到该位置
    highlightCurrentSubtitle(subtitle);
    
    // 如果启用了翻译，优先翻译当前字幕
    if (enableTranslation && !subtitle.translation) {
      // 设置为优先翻译的字幕
      prioritySubtitle = subtitle;
      
      // 添加到翻译队列的最前面
      translationQueue = [subtitle, ...translationQueue.filter(item => 
        item.startTime !== subtitle.startTime || item.endTime !== subtitle.endTime
      )];
      
      // 如果当前没有翻译进行中，开始翻译过程
      if (!isTranslating) {
        processTranslationQueue();
      }
    }
    
    // 如果当前字幕后面的几个字幕还没有翻译，也加入队列
    if (enableTranslation) {
      const nextSubtitles = findNextSubtitles(subtitle, 5);
      for (const nextSub of nextSubtitles) {
        // 检查这个字幕是否已经在队列中或已经有翻译
        const inQueue = translationQueue.some(item => 
          item.startTime === nextSub.startTime && item.endTime === nextSub.endTime
        );
        
        if (!nextSub.translation && !inQueue) {
          translationQueue.push(nextSub);
        }
      }
    }
  }
}

// Function to find the subtitle for the current time
function findSubtitleForTime(currentTime) {
  return subtitles.find(subtitle => 
    currentTime >= subtitle.startTime && currentTime <= subtitle.endTime
  );
}

// Function to update the subtitle display with all history
function updateSubtitleDisplay() {
  // 创建所有已显示字幕的HTML
  const subtitleHTML = displayedSubtitles.map(subtitle => {
    // 确保翻译结果被正确处理
    const translation = subtitle.translation || '';
    const showTranslation = enableTranslation && translation;
    
    // 处理可能过长的字幕文本，确保显示完整
    const formattedText = formatSubtitleText(subtitle.text);
    const formattedTranslation = showTranslation ? formatSubtitleText(translation) : '';
    
    if (showTranslation) {
      return `<div class="subtitle-entry" data-start="${subtitle.startTime}" data-end="${subtitle.endTime}">
        <div class="subtitle-original">${formattedText}</div>
        <div class="subtitle-translation">${formattedTranslation}</div>
      </div>`;
    } else {
      return `<div class="subtitle-entry" data-start="${subtitle.startTime}" data-end="${subtitle.endTime}">
        <div class="subtitle-original">${formattedText}</div>
      </div>`;
    }
  }).join('');
  
  // 更新内容
  subtitleElement.innerHTML = subtitleHTML;
  
  // 如果有当前字幕，确保它被高亮
  if (currentSubtitle) {
    highlightCurrentSubtitle(currentSubtitle);
  }
}

// Function to scroll to the bottom of the subtitle container
function scrollToBottom() {
  const scrollContainer = document.getElementById('srt-subtitle-scroll-container');
  if (scrollContainer) {
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }
}

// Function to translate text from English to Chinese
async function translateText(text) {
  // 检查缓存中是否已存在翻译
  if (translationCache[text]) {
    return translationCache[text];
  }
  
  // 尝试Google Translate API，这个通常是最快的
  try {
    const translation = await tryGoogleTranslateAPI(text);
    if (translation && translation !== text) {
      // 保存到缓存
      translationCache[text] = translation;
      return translation;
    }
  } catch (error) {
    console.error('Google翻译失败:', error);
  }
  
  // 如果Google API失败，尝试其他方法
  const translationMethods = [
    tryLibreTranslate,
    tryBaiduTranslate,
    simpleOfflineTranslation
  ];
  
  let lastError = null;
  
  // 依次尝试各种翻译方法
  for (const method of translationMethods) {
    try {
      const translation = await method(text);
      if (translation && translation !== text) {
        // 保存到缓存
        translationCache[text] = translation;
        return translation;
      }
    } catch (error) {
      console.error(`翻译方法失败: ${error.message}`);
      lastError = error;
      // 继续尝试下一种方法
    }
  }
  
  // 如果所有方法都失败，返回错误提示
  console.error('所有翻译方法都失败:', lastError);
  return `[翻译失败]`;
}

// Google Translate API (非官方接口)
async function tryGoogleTranslateAPI(text) {
  // 使用超时控制的fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时
  
  try {
    const encodedText = encodeURIComponent(text);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodedText}`;
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Google Translate API responded with status: ${response.status}`);
    }
    
    const data = await response.json();
    if (data && data[0] && data[0][0] && data[0][0][0]) {
      return data[0][0][0];
    } else {
      throw new Error('Unexpected response format from Google Translate');
    }
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// LibreTranslate API
async function tryLibreTranslate(text) {
  // 使用超时控制的fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时
  
  try {
    const response = await fetch('https://libretranslate.de/translate', {
      method: 'POST',
      body: JSON.stringify({
        q: text,
        source: 'en',
        target: 'zh',
        format: 'text'
      }),
      headers: {
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`LibreTranslate responded with status: ${response.status}`);
    }
    
    const data = await response.json();
    return data.translatedText;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// 百度翻译API替代方案（模拟浏览器请求）
async function tryBaiduTranslate(text) {
  // 使用超时控制的fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时
  
  try {
    const encodedText = encodeURIComponent(text);
    // 使用无需API密钥的接口（这只是一个示例，实际上可能无法工作）
    const url = `https://fanyi.baidu.com/transapi?from=en&to=zh&query=${encodedText}`;
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Baidu Translate responded with status: ${response.status}`);
    }
    
    const data = await response.json();
    if (data && data.data && data.data[0] && data.data[0].dst) {
      return data.data[0].dst;
    } else {
      throw new Error('Unexpected response format from Baidu Translate');
    }
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// 简单离线翻译方法 - 仅作为所有在线方法失败时的备用
function simpleOfflineTranslation(text) {
  // 这里可以实现一个非常基础的词典查找
  // 比如存储一些常见英文短语和单词的中文翻译
  const commonPhrases = {
    'hello': '你好',
    'thank you': '谢谢',
    'goodbye': '再见',
    'please': '请',
    'sorry': '对不起',
    'yes': '是',
    'no': '否',
    'ok': '好的',
    'i love you': '我爱你',
    'what': '什么',
    'when': '何时',
    'where': '哪里',
    'who': '谁',
    'why': '为什么',
    'how': '如何'
    // 可以扩展更多常用词汇
  };
  
  // 简单的文本映射，对于短语和简单句子可能有效
  // 实际使用需要更复杂的NLP处理
  for (const [eng, chn] of Object.entries(commonPhrases)) {
    if (text.toLowerCase().includes(eng)) {
      text = text.toLowerCase().replace(new RegExp(eng, 'gi'), chn);
    }
  }
  
  return text.includes('翻译失败') ? text : `[基础翻译] ${text}`;
}

// 移除所有字幕的高亮标记
function removeAllHighlights() {
  const allSubtitleEntries = document.querySelectorAll('.subtitle-entry');
  allSubtitleEntries.forEach(entry => {
    entry.classList.remove('current-subtitle');
    // 移除文本高亮
    const originalText = entry.querySelector('.subtitle-original');
    const translationText = entry.querySelector('.subtitle-translation');
    if (originalText) originalText.classList.remove('highlight-text');
    if (translationText) translationText.classList.remove('highlight-text');
  });
}

// 为当前播放的字幕添加高亮标记并滚动到视图中
function highlightCurrentSubtitle(subtitle) {
  const allSubtitleEntries = document.querySelectorAll('.subtitle-entry');
  let foundEntry = null;
  
  allSubtitleEntries.forEach(entry => {
    // 使用data属性匹配字幕
    const startTime = parseFloat(entry.dataset.start);
    const endTime = parseFloat(entry.dataset.end);
    
    if (startTime === subtitle.startTime && endTime === subtitle.endTime) {
      // 高亮条目本身（用于跟踪，但不会有视觉效果）
      entry.classList.add('current-subtitle');
      
      // 只高亮文本内容
      const originalText = entry.querySelector('.subtitle-original');
      const translationText = entry.querySelector('.subtitle-translation');
      if (originalText) originalText.classList.add('highlight-text');
      if (translationText) translationText.classList.add('highlight-text');
      
      foundEntry = entry;
    }
  });
  
  // 滚动到高亮的字幕位置（只在允许自动滚动时执行）
  if (foundEntry && autoScroll) {
    scrollToSubtitle(foundEntry);
  }
}

// 滚动到特定字幕位置，确保其可见
function scrollToSubtitle(subtitleElement) {
  const scrollContainer = document.getElementById('srt-subtitle-scroll-container');
  if (!scrollContainer) return;
  
  // 检查是否允许自动滚动，如果不允许则直接返回
  if (!autoScroll) return;
  
  const containerRect = scrollContainer.getBoundingClientRect();
  const subtitleRect = subtitleElement.getBoundingClientRect();
  
  // 计算元素相对于滚动容器的位置
  const relativeTop = subtitleRect.top - containerRect.top;
  const relativeBottom = subtitleRect.bottom - containerRect.top;
  
  // 判断元素是否在可视区域内
  const isInView = (
    relativeTop >= 0 &&
    relativeBottom <= containerRect.height
  );
  
  // 只有在允许自动滚动时才执行滚动
  const scrollTop = subtitleElement.offsetTop - (containerRect.height / 2) + (subtitleRect.height / 2);
  scrollContainer.scrollTop = Math.max(0, scrollTop);
  
  // 注意：不再在这里重置autoScroll状态，让鼠标事件控制
}

// 新增函数：格式化字幕文本，处理过长文本
function formatSubtitleText(text) {
  if (!text) return '';
  
  // 移除HTML标签，防止XSS
  text = text.replace(/<[^>]*>/g, '');
  
  // 处理特殊字符，确保安全显示
  text = text.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;')
             .replace(/"/g, '&quot;')
             .replace(/'/g, '&#039;');
  
  // 确保换行标签被保留
  text = text.replace(/\n/g, '<br>');
  
  return text;
}

// 查找当前字幕之后的n个字幕
function findNextSubtitles(currentSubtitle, count) {
  if (!currentSubtitle || !displayedSubtitles.length) return [];
  
  const currentIndex = displayedSubtitles.findIndex(subtitle => 
    subtitle.startTime === currentSubtitle.startTime && 
    subtitle.endTime === currentSubtitle.endTime
  );
  
  if (currentIndex === -1) return [];
  
  // 获取后面的n个字幕
  return displayedSubtitles.slice(currentIndex + 1, currentIndex + 1 + count);
}

// 处理翻译队列的函数
async function processTranslationQueue() {
  if (translationQueue.length === 0 || isTranslating) return;
  
  isTranslating = true;
  
  // 优先处理当前高亮的字幕
  let subtitleToTranslate;
  
  if (prioritySubtitle && translationQueue.includes(prioritySubtitle)) {
    subtitleToTranslate = prioritySubtitle;
    // 从队列中移除
    translationQueue = translationQueue.filter(item => item !== prioritySubtitle);
    // 重置优先字幕
    prioritySubtitle = null;
  } else {
    // 取出队列中的第一个字幕
    subtitleToTranslate = translationQueue.shift();
  }
  
  if (subtitleToTranslate) {
    try {
      // 显示"正在翻译"状态
      const subtitleIndex = displayedSubtitles.findIndex(item => 
        item.startTime === subtitleToTranslate.startTime && 
        item.endTime === subtitleToTranslate.endTime
      );
      
      if (subtitleIndex !== -1) {
        // 设置为正在翻译状态
        displayedSubtitles[subtitleIndex].translation = '正在翻译...';
        updateSubtitleDisplay();
        
        // 进行翻译
        const translation = await translateText(subtitleToTranslate.text);
        
        // 更新翻译结果
        displayedSubtitles[subtitleIndex].translation = translation;
        updateSubtitleDisplay();
      }
    } catch (error) {
      console.error('翻译错误:', error);
      
      // 查找字幕索引
      const subtitleIndex = displayedSubtitles.findIndex(item => 
        item.startTime === subtitleToTranslate.startTime && 
        item.endTime === subtitleToTranslate.endTime
      );
      
      if (subtitleIndex !== -1) {
        // 设置翻译失败状态
        displayedSubtitles[subtitleIndex].translation = `[翻译失败]`;
        updateSubtitleDisplay();
      }
    }
  }
  
  // 标记翻译完成
  isTranslating = false;
  
  // 继续处理队列中的下一个字幕
  if (translationQueue.length > 0) {
    // 短暂延迟，避免过快请求导致API限制
    setTimeout(processTranslationQueue, 300);
  }
} 