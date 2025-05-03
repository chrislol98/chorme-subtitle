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
let formatSubtitleStyle = true; // 是否格式化字幕样式（自然大小写）
let translationCache = {}; // 缓存翻译结果
let translationQueue = [];
let isTranslating = false;
let prioritySubtitle = null;
let isInIframe = false; // 标记当前脚本是否在iframe中运行
let iframeVideos = []; // 存储从iframe获取的视频信息
let mainPageId = null; // 主页面的唯一标识
let pageId = Math.random().toString(36).substring(2, 15); // 当前页面的唯一标识

// 检测当前脚本是否在iframe中运行
try {
  isInIframe = window.self !== window.top;
} catch (e) {
  isInIframe = true;
}

// 初始化跨域通信
initializeCrossFrameCommunication();

// 初始化跨域通信机制
function initializeCrossFrameCommunication() {
  // 如果在iframe中，向主页面报告这个iframe中的视频
  if (isInIframe) {
    window.addEventListener('message', function(event) {
      // 处理来自主页面的消息
      if (event.data.action === 'requestVideoElements') {
        mainPageId = event.data.pageId;
        reportVideoElements(event.data.pageId);
      } 
      // 处理获取视频时间的请求
      else if (event.data.action === 'getVideoTime') {
        const videos = findVideosInDocument(document);
        if (videos && videos.length > 0) {
          const bestVideo = selectBestVideo(videos);
          if (bestVideo) {
            // 报告视频时间
            try {
              window.parent.postMessage({
                action: 'videoTimeUpdate',
                targetId: event.data.pageId,
                pageId: pageId,
                currentTime: bestVideo.currentTime,
                paused: bestVideo.paused
              }, '*');
            } catch (e) {
              console.error('发送视频时间更新失败:', e);
            }
          }
        }
      }
    });
    
    // 定期检查视频并报告
    setInterval(reportVideoElements, 2000);
  } 
  // 如果是主页面，监听来自iframe的消息
  else {
    window.addEventListener('message', function(event) {
      // 处理iframe报告的视频元素
      if (event.data.action === 'reportVideoElements' && event.data.targetId === pageId) {
        // 记录iframe发现的视频
        if (event.data.hasVideo) {
          iframeVideos.push({
            iframeId: event.data.pageId,
            frameElement: findFrameBySource(event.source),
            videoInfo: event.data.videoInfo
          });
        }
      }
      // 处理iframe报告的视频时间更新
      else if (event.data.action === 'videoTimeUpdate' && event.data.targetId === pageId) {
        // 查找并更新对应的视频代理
        for (const iframe of iframeVideos) {
          if (iframe.iframeId === event.data.pageId && videoElement && videoElement._isIframeVideoProxy && 
              videoElement._iframeInfo && videoElement._iframeInfo.iframeId === event.data.pageId) {
            // 更新代理的视频时间
            videoElement.currentTime = event.data.currentTime;
            videoElement.paused = event.data.paused;
            break;
          }
        }
      }
    });
    
    // 广播获取视频元素的请求
    window.setTimeout(broadcastVideoElementRequest, 500);
    window.setInterval(broadcastVideoElementRequest, 5000);
  }
}

// 在iframe中发现视频时，向主页面报告
function reportVideoElements(targetId) {
  // 先检查本iframe中是否有视频元素
  const videos = findVideosInDocument(document);
  
  if (videos && videos.length > 0) {
    // 取最适合的视频
    const bestVideo = selectBestVideo(videos);
    
    if (bestVideo) {
      try {
        // 向父窗口发送消息
        window.top.postMessage({
          action: 'reportVideoElements',
          targetId: targetId || mainPageId,
          pageId: pageId,
          hasVideo: true,
          videoInfo: {
            width: bestVideo.videoWidth,
            height: bestVideo.videoHeight,
            duration: bestVideo.duration,
            currentTime: bestVideo.currentTime,
            paused: bestVideo.paused
          }
        }, '*');
      } catch (e) {
        console.error('向父窗口发送消息失败:', e);
      }
    }
  }
}

// 找到与source对象关联的iframe元素
function findFrameBySource(source) {
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    if (iframe.contentWindow === source) {
      return iframe;
    }
  }
  return null;
}

// 广播请求以获取所有iframe中的视频元素
function broadcastVideoElementRequest() {
  const iframes = document.querySelectorAll('iframe');
  iframes.forEach(iframe => {
    try {
      iframe.contentWindow.postMessage({
        action: 'requestVideoElements',
        pageId: pageId
      }, '*');
    } catch (e) {
      // 忽略跨域错误
    }
  });
}

// 使用iframe API从跨域iframe获取视频元素
function createScriptToAccessVideo(frameId) {
  return `
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length > 0) {
      const videoInfo = videos.map(v => ({
        width: v.videoWidth,
        height: v.videoHeight,
        duration: v.duration,
        currentTime: v.currentTime,
        paused: v.paused
      }));
      window.parent.postMessage({
        action: 'iframeVideoFound',
        frameId: '${frameId}',
        videoInfo: videoInfo
      }, '*');
    }
  `;
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'applySubtitles') {
    try {
      // 如果在iframe中则不处理字幕应用请求
      if (isInIframe) {
        sendResponse({success: false, error: 'Running in iframe'});
        return true;
      }
      
      // Get subtitles from the message
      subtitles = request.subtitles;
      
      // Reset displayed subtitles history
      displayedSubtitles = [];
      
      // Clear translation cache
      translationCache = {};
      
      // 设置字幕格式化选项
      if (request.hasOwnProperty('formatSubtitleStyle')) {
        formatSubtitleStyle = request.formatSubtitleStyle;
      }
      
      // 设置翻译选项
      if (request.hasOwnProperty('enableTranslation')) {
        enableTranslation = request.enableTranslation;
      }
      
      // Find video element on the page
      videoElement = findVideoElement();
      
      if (!videoElement) {
        // 如果没有立即找到视频元素，设置一个延迟等待
        // MutationObserver会在视频出现时处理字幕显示
        console.log('视频元素未找到，正在等待视频加载...');
        
        // 设置一个有限的等待时间
        const videoDetectionTimeout = setTimeout(() => {
          if (!videoElement) {
            sendResponse({success: false, error: 'No video element found on this page after waiting.'});
          }
        }, 15000); // 15秒等待时间
        
        // 返回一个初步的成功响应，表示正在等待视频加载
        sendResponse({success: true, message: 'Waiting for video to load...'});
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
  } else if (request.action === 'toggleSubtitleStyle') {
    // 切换字幕样式
    formatSubtitleStyle = request.formatStyle;
    // 清空现有字幕并重新加载，应用新设置
    displayedSubtitles = [];
    loadAllSubtitles();
    sendResponse({success: true});
    return true;
  } else if (request.action === 'checkVideoStatus') {
    // 用于检查当前页面是否有视频元素的新消息类型
    try {
      // 如果在iframe中则不响应视频状态检查
      if (isInIframe) {
        sendResponse({success: false, error: 'Running in iframe'});
        return true;
      }
      
      if (!videoElement) {
        videoElement = findVideoElement();
      }
      
      sendResponse({
        success: true, 
        hasVideo: !!videoElement,
        videoDetails: videoElement ? {
          duration: videoElement.duration,
          currentTime: videoElement.currentTime,
          paused: videoElement.paused
        } : null
      });
    } catch (error) {
      sendResponse({success: false, error: error.message});
    }
    return true;
  }
});

// Function to find the main video element on the page
function findVideoElement() {
  // 避免在iframe中运行时查找视频元素
  if (isInIframe) return null;
  
  // 先检查当前文档中的视频元素
  const mainPageVideos = findVideosInDocument(document);
  let bestVideo = null;
  
  if (mainPageVideos && mainPageVideos.length > 0) {
    bestVideo = selectBestVideo(mainPageVideos);
    if (bestVideo) return bestVideo;
  }
  
  // 检查从iframe报告的视频信息
  if (iframeVideos.length > 0) {
    // 按视频尺寸排序找到最大的视频
    iframeVideos.sort((a, b) => {
      const areaA = a.videoInfo.width * a.videoInfo.height;
      const areaB = b.videoInfo.width * b.videoInfo.height;
      return areaB - areaA; // 降序排列
    });
    
    // 找到包含最大视频的iframe
    const bestIframeInfo = iframeVideos[0];
    
    if (bestIframeInfo.frameElement) {
      // 使用特殊方法处理iframe中的视频
      console.log('发现iframe中的视频，使用跨域处理方法');
      
      // 使用iframe对象来引用视频
      // 注意：这不是直接访问视频元素本身，而是创建一个代理对象
      // 这个对象模拟了视频API但实际操作是通过消息传递
      return createVideoProxy(bestIframeInfo);
    }
  }
  
  // 如果仍然没找到，尝试查找自定义视频播放器
  const customPlayers = findCustomVideoPlayers();
  if (customPlayers.length > 0) {
    return customPlayers[0];
  }
  
  // 如果还是没找到，尝试使用MutationObserver监听DOM变化等待视频出现
  setupVideoDetectionObserver();
  
  return null;
}

// 创建一个视频代理对象，用于处理iframe中的视频
function createVideoProxy(iframeInfo) {
  // 创建一个模拟视频元素的代理对象
  const proxy = document.createElement('video');
  
  // 添加特殊属性标记这是一个代理
  proxy._isIframeVideoProxy = true;
  proxy._iframeInfo = iframeInfo;
  
  // 从iframe报告的信息设置初始属性
  proxy.videoWidth = iframeInfo.videoInfo.width;
  proxy.videoHeight = iframeInfo.videoInfo.height;
  proxy.duration = iframeInfo.videoInfo.duration;
  proxy.currentTime = iframeInfo.videoInfo.currentTime;
  proxy.paused = iframeInfo.videoInfo.paused;
  
  // 设置一个定时器来更新时间信息
  setInterval(() => {
    // 模拟视频播放，每100ms更新currentTime
    if (!proxy.paused && proxy.currentTime < proxy.duration) {
      proxy.currentTime += 0.1;
    }
  }, 100);
  
  // 计算并设置代理元素的位置
  const rect = iframeInfo.frameElement.getBoundingClientRect();
  proxy.getBoundingClientRect = function() {
    return rect;
  };
  
  return proxy;
}

// 在文档中查找所有视频元素
function findVideosInDocument(doc) {
  if (!doc) return [];
  
  // 查找标准video标签
  const standardVideos = Array.from(doc.querySelectorAll('video'));
  
  // 查找可能被隐藏在shadow DOM中的视频
  const elementsWithShadow = doc.querySelectorAll('*');
  const shadowVideos = [];
  
  for (const elem of elementsWithShadow) {
    if (elem.shadowRoot) {
      const videosInShadow = Array.from(elem.shadowRoot.querySelectorAll('video'));
      shadowVideos.push(...videosInShadow);
    }
  }
  
  return [...standardVideos, ...shadowVideos];
}

// 从找到的视频元素中选择最佳的一个
function selectBestVideo(videos) {
  if (videos.length === 0) return null;
  if (videos.length === 1) return videos[0];
  
  // 多个视频元素时的选择策略：
  // 1. 优先选择正在播放的视频
  const playingVideos = videos.filter(v => !v.paused && !v.ended && v.currentTime > 0);
  if (playingVideos.length === 1) return playingVideos[0];
  
  // 2. 选择时长最长的视频（通常是主内容）
  let longestDurationVideo = null;
  let maxDuration = 0;
  
  for (const video of videos) {
    if (!isNaN(video.duration) && video.duration > maxDuration && isElementVisible(video)) {
      maxDuration = video.duration;
      longestDurationVideo = video;
    }
  }
  
  if (longestDurationVideo) return longestDurationVideo;
  
  // 3. 如果无法确定时长，选择面积最大的视频
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

// 尝试查找自定义视频播放器
function findCustomVideoPlayers() {
  const customPlayers = [];
  
  // YouTube播放器
  const ytPlayer = document.querySelector('.html5-video-player') || 
                  document.querySelector('#movie_player');
  if (ytPlayer) {
    const ytVideo = ytPlayer.querySelector('video');
    if (ytVideo) customPlayers.push(ytVideo);
  }
  
  // HTML5 Video.js 播放器
  const vjsPlayers = document.querySelectorAll('.video-js');
  for (const player of vjsPlayers) {
    const vjsVideo = player.querySelector('video');
    if (vjsVideo) customPlayers.push(vjsVideo);
  }
  
  // JW Player
  const jwPlayers = document.querySelectorAll('.jwplayer');
  for (const player of jwPlayers) {
    const jwVideo = player.querySelector('video');
    if (jwVideo) customPlayers.push(jwVideo);
  }
  
  // Bilibili播放器
  const biliPlayers = document.querySelectorAll('.bilibili-player-video');
  for (const player of biliPlayers) {
    const biliVideo = player.querySelector('video');
    if (biliVideo) customPlayers.push(biliVideo);
  }
  
  // HTML5 Plus UI
  const h5pVideos = document.querySelectorAll('.h5p-video');
  for (const video of h5pVideos) {
    if (video.tagName === 'VIDEO') customPlayers.push(video);
  }
  
  return customPlayers;
}

// 设置MutationObserver来监听DOM变化，等待视频出现
function setupVideoDetectionObserver() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        // 检查是否添加了新的视频元素
        const videos = findVideosInDocument(document);
        if (videos.length > 0) {
          const bestVideo = selectBestVideo(videos);
          if (bestVideo) {
            videoElement = bestVideo;
            // 如果已经加载了字幕，立即应用
            if (subtitles.length > 0 && !checkInterval) {
              setupSubtitleModal();
              loadAllSubtitles();
              startSubtitleTracking();
            }
            observer.disconnect();
          }
        }
      }
    }
  });
  
  // 开始观察DOM变化
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // 60秒后停止观察，避免无限期监听
  setTimeout(() => observer.disconnect(), 60000);
}

// Function to check if an element is visible
function isElementVisible(element) {
  if (!element) return false;
  
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  
  // 检查元素是否在视口内
  const isInViewport = rect.width > 0 && 
                      rect.height > 0 && 
                      rect.top < window.innerHeight &&
                      rect.left < window.innerWidth &&
                      rect.bottom > 0 &&
                      rect.right > 0;
                      
  // 检查元素是否可见                    
  return style.display !== 'none' && 
         style.visibility !== 'hidden' && 
         parseFloat(style.opacity) > 0 &&
         isInViewport;
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
      border-left: 3px solid #ffcc00;
      padding-left: 7px;
      background-color: rgba(255, 204, 0, 0.1);
      transition: all 0.3s ease;
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
  
  // 添加字幕样式格式化开关
  const styleToggle = document.createElement('div');
  styleToggle.id = 'style-toggle';
  styleToggle.style.marginLeft = '10px';
  styleToggle.innerHTML = `
    <label class="toggle-switch">
      <input type="checkbox" ${formatSubtitleStyle ? 'checked' : ''} id="style-checkbox">
      <span class="toggle-slider"></span>
    </label>
    <span>格式化</span>
  `;
  
  // 创建控件容器
  const controlsContainer = document.createElement('div');
  controlsContainer.style.display = 'flex';
  controlsContainer.style.alignItems = 'center';
  controlsContainer.appendChild(translationToggle);
  controlsContainer.appendChild(styleToggle);
  
  modalHeader.innerHTML = '<span>字幕 (拖动移动)</span>';
  modalHeader.appendChild(controlsContainer);
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
  
  // 获取视频位置信息，无论是普通视频还是iframe视频代理
  let videoRect;
  
  if (videoElement._isIframeVideoProxy) {
    // 对于iframe视频代理，使用iframe的位置
    videoRect = videoElement._iframeInfo.frameElement.getBoundingClientRect();
  } else {
    // 对于普通视频，直接获取位置
    videoRect = videoElement.getBoundingClientRect();
  }
  
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
  
  // 字幕样式开关事件监听
  const styleCheckbox = document.getElementById('style-checkbox');
  if (styleCheckbox) {
    styleCheckbox.addEventListener('change', function() {
      formatSubtitleStyle = this.checked;
      // 更新字幕显示
      updateSubtitleDisplay();
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
  
  // 如果当前已经有字幕在播放，确保它被高亮和滚动
  if (videoElement && subtitles.length > 0) {
    const currentTime = videoElement.currentTime * 1000;
    currentSubtitle = findSubtitleForTime(currentTime);
    
    if (currentSubtitle) {
      // 短暂延迟，确保DOM更新后再滚动
      setTimeout(() => {
        updateSubtitleDisplay();
      }, 100);
    }
  }
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
  
  // 只有当不是代理视频时才添加事件监听器
  if (videoElement && !videoElement._isIframeVideoProxy) {
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
}

// Function to update the subtitle based on current video time
function updateSubtitle() {
  if (!videoElement || !subtitleElement || subtitles.length === 0) return;
  
  let currentTime;
  
  // 检查是否是iframe视频代理
  if (videoElement._isIframeVideoProxy) {
    // 使用代理对象的currentTime
    currentTime = videoElement.currentTime * 1000; // Convert to ms
    
    // 尝试通过消息传递更新视频时间
    if (videoElement._iframeInfo && videoElement._iframeInfo.frameElement) {
      try {
        // 向iframe发送消息，请求当前时间
        videoElement._iframeInfo.frameElement.contentWindow.postMessage({
          action: 'getVideoTime',
          pageId: pageId
        }, '*');
      } catch (e) {
        // 忽略跨域错误，使用模拟的时间
      }
    }
  } else {
    // 直接从视频元素获取时间
    currentTime = videoElement.currentTime * 1000; // Convert to ms
  }
  
  // 找到当前时间对应的字幕
  const subtitle = findSubtitleForTime(currentTime);
  
  // 如果找到了新的当前字幕
  if (subtitle && subtitle !== currentSubtitle) {
    // 更新当前字幕
    currentSubtitle = subtitle;
    
    // 更新字幕显示，这将触发高亮和滚动
    updateSubtitleDisplay();
    
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
  // 确保字幕内容元素存在
  const contentElement = document.getElementById('srt-subtitle-content');
  if (!contentElement) return;

  // 清空之前的字幕显示
  contentElement.innerHTML = '';

  // 创建并显示字幕历史
  displayedSubtitles.forEach(subtitle => {
    const entryElement = document.createElement('div');
    entryElement.classList.add('subtitle-entry');
    entryElement.dataset.startTime = subtitle.startTime;
    entryElement.dataset.endTime = subtitle.endTime;

    // 原始字幕文本
    const originalElement = document.createElement('div');
    originalElement.classList.add('subtitle-original');
    originalElement.textContent = formatSubtitleText(subtitle.text);
    entryElement.appendChild(originalElement);

    // 如果有翻译，显示翻译文本
    if (subtitle.translation && enableTranslation) {
      const translationElement = document.createElement('div');
      translationElement.classList.add('subtitle-translation');
      translationElement.textContent = subtitle.translation;
      entryElement.appendChild(translationElement);
    }

    contentElement.appendChild(entryElement);
  });

  // 如果有当前字幕，添加高亮
  if (currentSubtitle) {
    highlightCurrentSubtitle(currentSubtitle);
  
    // 如果自动滚动是开启的，确保滚动到当前字幕
    if (autoScroll) {
      // 使用requestAnimationFrame确保DOM更新后再滚动
      requestAnimationFrame(() => {
        const currentEntryElement = document.querySelector(`.subtitle-entry[data-start-time="${currentSubtitle.startTime}"]`);
        if (currentEntryElement) {
          scrollToSubtitle(currentEntryElement);
        }
      });
    }
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
    // 预处理文本，移除HTML标签
    const cleanText = text.replace(/<[^>]*>/g, '');
    const encodedText = encodeURIComponent(cleanText);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodedText}`;
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Google Translate API responded with status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Google翻译API返回格式为嵌套数组，其中可能包含多个翻译段落
    // 需要正确提取和组合所有翻译结果
    if (data && data[0]) {
      // 收集所有翻译片段
      let fullTranslation = '';
      for (const segment of data[0]) {
        if (segment && segment[0]) {
          fullTranslation += segment[0];
        }
      }
      
      if (fullTranslation) {
        return fullTranslation;
      }
    }
    
    throw new Error('Unexpected response format from Google Translate');
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
    // 预处理文本，移除HTML标签
    const cleanText = text.replace(/<[^>]*>/g, '');
    
    const response = await fetch('https://libretranslate.de/translate', {
      method: 'POST',
      body: JSON.stringify({
        q: cleanText,
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
    // 预处理文本，移除HTML标签
    const cleanText = text.replace(/<[^>]*>/g, '');
    const encodedText = encodeURIComponent(cleanText);
    
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

// 为当前播放的字幕添加高亮标记
function highlightCurrentSubtitle(subtitle) {
  const allSubtitleEntries = document.querySelectorAll('.subtitle-entry');
  let foundEntry = null;
  
  allSubtitleEntries.forEach(entry => {
    // 使用data属性匹配字幕
    const startTime = parseFloat(entry.dataset.startTime);
    const endTime = parseFloat(entry.dataset.endTime);
    
    if (startTime === subtitle.startTime && endTime === subtitle.endTime) {
      // 高亮条目本身
      entry.classList.add('current-subtitle');
      
      // 高亮文本内容
      const originalText = entry.querySelector('.subtitle-original');
      const translationText = entry.querySelector('.subtitle-translation');
      if (originalText) originalText.classList.add('highlight-text');
      if (translationText) translationText.classList.add('highlight-text');
      
      foundEntry = entry;
    }
  });
  
  // 返回找到的元素，而不是在这里直接滚动
  return foundEntry;
}

// 滚动到特定字幕位置，确保其可见并居中
function scrollToSubtitle(subtitleElement) {
  if (!subtitleElement) return;
  
  const scrollContainer = document.getElementById('srt-subtitle-scroll-container');
  if (!scrollContainer) return;
  
  // 检查是否允许自动滚动，如果不允许则直接返回
  if (!autoScroll) return;
  
  const containerRect = scrollContainer.getBoundingClientRect();
  const subtitleRect = subtitleElement.getBoundingClientRect();
  
  // 始终将字幕元素滚动到容器中央位置，无论它是否在可视区域内
  const scrollTop = subtitleElement.offsetTop - (containerRect.height / 2) + (subtitleRect.height / 2);
  scrollContainer.scrollTop = Math.max(0, scrollTop);
}

// 格式化字幕文本（增加格式化处理逻辑）
function formatSubtitleText(text) {
  if (!formatSubtitleStyle) {
    // 如果不需要格式化，直接返回原始文本
    return text;
  }

  if (!text) return '';

  // 首先移除HTML标签，如<i></i>, <b></b>等
  let formattedText = text.replace(/<[^>]*>/g, '');
  
  // 处理特殊HTML实体
  formattedText = formattedText
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  
  // 格式化字幕的逻辑：
  // 1. 移除多余空格
  // 2. 将全部大写的文本转换为首字母大写的格式
  formattedText = formattedText.trim();
  
  // 更可靠的全大写检测 - 包含至少2个字符
  const hasLowerCase = /[a-z]/.test(formattedText);
  const hasUpperCase = /[A-Z]/.test(formattedText);
  const hasLetters = hasLowerCase || hasUpperCase;
  const isLongEnough = formattedText.replace(/[^a-zA-Z]/g, '').length >= 2;
  
  // 如果文本包含字母且没有小写字母（即全大写），且长度足够，则格式化
  if (hasLetters && !hasLowerCase && hasUpperCase && isLongEnough) {
    // 全部小写后再格式化
    formattedText = formattedText.toLowerCase();
    
    // 句子首字母大写 - 增强版本
    formattedText = formattedText
      // 句子开头首字母大写
      .replace(/(^\s*\w)/g, c => c.toUpperCase())
      // 句号、感叹号、问号后的首字母大写
      .replace(/([.!?]\s*\w)/g, c => c.toUpperCase())
      // 常见专有名词首字母大写
      .replace(/\bi\b/g, 'I')
      .replace(/\bdr\.\s+\w/gi, match => match.toUpperCase())
      .replace(/\bmr\.\s+\w/gi, match => match.toUpperCase())
      .replace(/\bmrs\.\s+\w/gi, match => match.toUpperCase())
      .replace(/\bms\.\s+\w/gi, match => match.toUpperCase());
    
    // 处理常见缩写和专有名词
    const commonAbbreviations = {
      'u.s.': 'U.S.',
      'u.k.': 'U.K.',
      'i.e.': 'i.e.',
      'e.g.': 'e.g.',
      'etc.': 'etc.',
      'nasa': 'NASA',
      'fbi': 'FBI',
      'cia': 'CIA',
      'bbc': 'BBC',
      'cnn': 'CNN'
    };
    
    // 应用常见缩写和专有名词的大写规则
    for (const [abbr, proper] of Object.entries(commonAbbreviations)) {
      formattedText = formattedText.replace(
        new RegExp('\\b' + abbr + '\\b', 'gi'), 
        proper
      );
    }
  }
  
  // 移除字幕中的一些常见无意义标记
  formattedText = formattedText
    .replace(/\s*--\s*/g, ' ')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\(\s*\)/g, '')     // 移除空括号
    .replace(/\[\s*\]/g, '')     // 移除空方括号
    .replace(/\s{2,}/g, ' ');    // 将多个空格替换为单个空格
  
  return formattedText;
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
        
        // 预处理字幕文本，移除HTML标签
        const cleanText = subtitleToTranslate.text.replace(/<[^>]*>/g, '');
        
        // 进行翻译
        const translation = await translateText(cleanText);
        
        // 确保没有返回空翻译
        if (!translation || translation === '[翻译失败]') {
          displayedSubtitles[subtitleIndex].translation = '[翻译失败]';
        } else {
          // 更新翻译结果
          displayedSubtitles[subtitleIndex].translation = translation;
        }
        
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