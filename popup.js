document.addEventListener('DOMContentLoaded', function() {
  const fileSelector = document.getElementById('file-selector');
  const applyButton = document.getElementById('apply-button');
  const statusDiv = document.getElementById('status');
  const translationToggle = document.getElementById('translation-toggle');
  const videoIndicator = document.getElementById('video-indicator');
  const loadingIndicator = document.getElementById('loading-indicator');
  
  // 检查当前标签页是否有视频
  checkVideoStatus();
  
  // 每3秒检查一次视频状态
  const videoCheckInterval = setInterval(checkVideoStatus, 3000);
  
  // 从存储中获取翻译设置
  chrome.storage.local.get(['enableTranslation'], function(result) {
    if (result.hasOwnProperty('enableTranslation')) {
      translationToggle.checked = result.enableTranslation;
    }
  });
  
  // 当翻译开关状态改变时保存设置
  translationToggle.addEventListener('change', function() {
    chrome.storage.local.set({ enableTranslation: this.checked });
    
    // 如果已经应用了字幕，则向当前页面发送更新翻译设置的消息
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'toggleTranslation',
        enable: translationToggle.checked
      });
    });
  });
  
  applyButton.addEventListener('click', function() {
    if (!fileSelector.files.length) {
      updateStatus('请先选择 .srt 文件。', 'error');
      return;
    }
    
    const file = fileSelector.files[0];
    if (!file.name.endsWith('.srt')) {
      updateStatus('请选择有效的 .srt 文件。', 'error');
      return;
    }
    
    // 显示加载状态
    updateStatus('正在处理字幕文件...', 'loading');
    applyButton.disabled = true;
    loadingIndicator.style.display = 'inline-block';
    
    const reader = new FileReader();
    
    reader.onload = function(e) {
      const contents = e.target.result;
      const subtitles = parseSRT(contents);
      
      if (subtitles.length === 0) {
        updateStatus('无法从文件中解析出字幕。', 'error');
        applyButton.disabled = false;
        loadingIndicator.style.display = 'none';
        return;
      }
      
      // 保存翻译设置
      chrome.storage.local.set({ enableTranslation: translationToggle.checked });
      
      // 发送解析后的字幕到content script
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'applySubtitles',
          subtitles: subtitles,
          enableTranslation: translationToggle.checked
        }, function(response) {
          loadingIndicator.style.display = 'none';
          
          if (response && response.success) {
            if (response.message === 'Waiting for video to load...') {
              updateStatus('正在等待视频加载...', 'searching');
              // 稍后再检查视频状态
              setTimeout(checkVideoStatus, 1000);
            } else {
              updateStatus('字幕应用成功！', 'ready');
            }
          } else {
            updateStatus('应用字幕出错：' + (response ? response.error : '页面无响应'), 'error');
          }
          applyButton.disabled = false;
        });
      });
    };
    
    reader.onerror = function() {
      updateStatus('读取文件时出错。', 'error');
      applyButton.disabled = false;
      loadingIndicator.style.display = 'none';
    };
    
    reader.readAsText(file);
  });
  
  // 功能：更新状态显示
  function updateStatus(message, type) {
    statusDiv.textContent = message;
    
    // 移除所有现有状态类
    statusDiv.classList.remove('status-searching', 'status-ready', 'status-error');
    
    // 添加新的状态类
    if (type === 'searching') {
      statusDiv.classList.add('status-searching');
    } else if (type === 'ready') {
      statusDiv.classList.add('status-ready');
    } else if (type === 'error') {
      statusDiv.classList.add('status-error');
    } else if (type === 'loading') {
      statusDiv.classList.add('status-searching');
    }
  }
  
  // 功能：检查当前标签页是否有视频
  function checkVideoStatus() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      // 避免在没有标签页的情况下发送消息
      if (!tabs || tabs.length === 0) return;
      
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'checkVideoStatus'
      }, function(response) {
        // 忽略通信错误，这可能是因为content脚本还没有加载
        if (!response) return;
        
        if (response.success) {
          if (response.hasVideo) {
            updateStatus('页面中检测到视频，可以应用字幕。', 'ready');
            videoIndicator.classList.add('video-found');
            applyButton.disabled = false;
          } else {
            updateStatus('正在搜索视频元素...', 'searching');
            videoIndicator.classList.remove('video-found');
            applyButton.disabled = true;
          }
        }
      });
    });
  }
  
  // SRT parser function
  function parseSRT(srtContent) {
    const subtitles = [];
    
    // Split by double newline to separate subtitle entries
    const entries = srtContent.trim().split(/\r?\n\r?\n/);
    
    for (const entry of entries) {
      const lines = entry.trim().split(/\r?\n/);
      
      // Need at least 3 lines (index, timestamps, text)
      if (lines.length < 3) continue;
      
      // Find the timestamp line (contains --> )
      const timelineIndex = lines.findIndex(line => line.includes('-->'));
      if (timelineIndex === -1) continue;
      
      // Parse the timeline
      const timeline = lines[timelineIndex];
      const times = timeline.split(' --> ');
      if (times.length !== 2) continue;
      
      // Convert timestamps to milliseconds
      const startTime = timeToMs(times[0]);
      const endTime = timeToMs(times[1]);
      
      if (isNaN(startTime) || isNaN(endTime)) continue;
      
      // Get subtitle text (all lines after the timestamp line)
      const text = lines.slice(timelineIndex + 1).join('<br>');
      
      subtitles.push({
        startTime,
        endTime,
        text
      });
    }
    
    return subtitles;
  }
  
  // Convert SRT timestamp to milliseconds
  function timeToMs(timeString) {
    const match = timeString.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!match) return NaN;
    
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const milliseconds = parseInt(match[4], 10);
    
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds;
  }
}); 