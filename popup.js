document.addEventListener('DOMContentLoaded', function() {
  const fileSelector = document.getElementById('file-selector');
  const applyButton = document.getElementById('apply-button');
  const statusDiv = document.getElementById('status');
  const translationToggle = document.getElementById('translation-toggle');
  
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
      statusDiv.textContent = '请先选择 .srt 文件。';
      return;
    }
    
    const file = fileSelector.files[0];
    if (!file.name.endsWith('.srt')) {
      statusDiv.textContent = '请选择有效的 .srt 文件。';
      return;
    }
    
    const reader = new FileReader();
    
    reader.onload = function(e) {
      const contents = e.target.result;
      const subtitles = parseSRT(contents);
      
      if (subtitles.length === 0) {
        statusDiv.textContent = '无法从文件中解析出字幕。';
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
          if (response && response.success) {
            statusDiv.textContent = '字幕应用成功！';
          } else {
            statusDiv.textContent = '应用字幕出错：' + (response ? response.error : '页面无响应');
          }
        });
      });
    };
    
    reader.onerror = function() {
      statusDiv.textContent = '读取文件时出错。';
    };
    
    reader.readAsText(file);
  });
  
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