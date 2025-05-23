document.addEventListener('DOMContentLoaded', async function() {
    const testCompletionButton = document.getElementById('testCompletion');
    const testErrorButton = document.getElementById('testError');
    const updateSelectorsButton = document.getElementById('updateSelectors');
    const viewGithubButton = document.getElementById('viewGithub');
    const reportIssueButton = document.getElementById('reportIssue');
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeValue = document.getElementById('volumeValue');
    const selectorStatus = document.getElementById('selectorStatus');
    const selectorDetails = document.getElementById('selectorDetails');
  
    // Load current volume setting
    async function loadVolume() {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'getVolume' });
        const volume = Math.round(response.volume * 100);
        volumeSlider.value = volume;
        volumeValue.textContent = volume + '%';
      } catch (error) {
        console.error('Error loading volume:', error);
      }
    }
  
    // Handle volume slider changes
    volumeSlider.addEventListener('input', async function() {
      const volume = parseInt(this.value);
      volumeValue.textContent = volume + '%';
      
      try {
        await chrome.runtime.sendMessage({ 
          action: 'setVolume', 
          volume: volume / 100 
        });
        
        // Also update the offscreen document immediately
        await chrome.runtime.sendMessage({
          action: 'playAudio',
          type: 'setVolume',
          volume: volume / 100
        });
      } catch (error) {
        console.error('Error setting volume:', error);
      }
    });
  
    // Load selector information
    async function loadSelectorInfo() {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'getSelectors' });
        const selectors = response.selectors;
        
        if (selectors) {
          selectorStatus.innerHTML = `📊 Selectors v${selectors.version}`;
          
          const updateDate = selectors.lastUpdated ? 
            new Date(selectors.lastUpdated).toLocaleDateString() : 
            'Unknown';
          
          const stopButtonCount = selectors.selectors.generation.stopButton.length;
          const loadingCount = selectors.selectors.generation.loading.length;
          const errorCount = selectors.selectors.error.length;
          
          selectorDetails.innerHTML = `
            <strong>Version:</strong> ${selectors.version}<br>
            <strong>Updated:</strong> ${updateDate}<br>
            <strong>Stop Selectors:</strong> ${stopButtonCount}<br>
            <strong>Loading Selectors:</strong> ${loadingCount}<br>
            <strong>Error Selectors:</strong> ${errorCount}
          `;
        } else {
          selectorStatus.innerHTML = '❌ No selectors loaded';
          selectorDetails.innerHTML = 'Failed to load selector information';
        }
      } catch (error) {
        console.error('Error loading selector info:', error);
        selectorStatus.innerHTML = '❌ Error loading selectors';
        selectorDetails.innerHTML = 'Error: ' + error.message;
      }
    }
  
    // Test completion sound
    testCompletionButton.addEventListener('click', async function() {
      try {
        await chrome.runtime.sendMessage({ action: 'playCompletionSound' });
        testCompletionButton.innerHTML = '✅ Played!';
        setTimeout(() => {
          testCompletionButton.innerHTML = '🔔 Test Completion Sound';
        }, 2000);
      } catch (error) {
        console.error('Error playing completion sound:', error);
      }
    });
  
    // Test error sound
    testErrorButton.addEventListener('click', async function() {
      try {
        await chrome.runtime.sendMessage({ action: 'playErrorSound' });
        testErrorButton.innerHTML = '✅ Played!';
        setTimeout(() => {
          testErrorButton.innerHTML = '⚠️ Test Error Sound';
        }, 2000);
      } catch (error) {
        console.error('Error playing error sound:', error);
      }
    });
  
    // Update selectors
    updateSelectorsButton.addEventListener('click', async function() {
      updateSelectorsButton.innerHTML = '🔄 Updating...';
      updateSelectorsButton.disabled = true;
      
      try {
        await chrome.runtime.sendMessage({ action: 'updateSelectors' });
        updateSelectorsButton.innerHTML = '✅ Updated!';
        await loadSelectorInfo(); // Refresh the display
        
        setTimeout(() => {
          updateSelectorsButton.innerHTML = '🔄 Update Selectors';
          updateSelectorsButton.disabled = false;
        }, 2000);
      } catch (error) {
        console.error('Error updating selectors:', error);
        updateSelectorsButton.innerHTML = '❌ Failed';
        setTimeout(() => {
          updateSelectorsButton.innerHTML = '🔄 Update Selectors';
          updateSelectorsButton.disabled = false;
        }, 2000);
      }
    });
  
    // View GitHub repository
    viewGithubButton.addEventListener('click', function() {
      chrome.tabs.create({ 
        url: 'https://github.com/claude-sound-extension/selectors'
      });
    });
  
    // Report an issue
    reportIssueButton.addEventListener('click', async function() {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const response = await chrome.runtime.sendMessage({ 
          action: 'reportIssue',
          issue: 'Selectors not working correctly',
          url: tab.url,
          userAgent: navigator.userAgent
        });
        
        // Create GitHub issue URL with pre-filled data
        const issueUrl = `${response.issuesUrl}/new?title=${encodeURIComponent(response.issueData.title)}&body=${encodeURIComponent(response.issueData.body)}`;
        chrome.tabs.create({ url: issueUrl });
      } catch (error) {
        console.error('Error creating issue report:', error);
        // Fallback to just opening issues page
        chrome.tabs.create({ 
          url: 'https://github.com/claude-sound-extension/selectors/issues/new'
        });
      }
    });
  
    // Initial loads
    await loadVolume();
    await loadSelectorInfo();
  });