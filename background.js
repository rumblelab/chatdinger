// Updated background script with better error handling
// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  if (message.action === 'testSound') {
    
    // Play test sound by injecting into active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const tab = tabs[0];
        
        // Check if the tab URL is accessible (not chrome://, chrome-extension://, etc.)
        if (tab.url.startsWith('chrome://') || 
            tab.url.startsWith('chrome-extension://') || 
            tab.url.startsWith('edge://') || 
            tab.url.startsWith('about:')) {
          console.warn('Background: Cannot inject into chrome:// or restricted pages');
          sendResponse({ 
            status: 'Cannot play test sound on this page', 
            error: 'Please open ChatGPT or Claude to test sounds' 
          });
          return;
        }
        
        // Check if tab is a supported site
        const supportedSites = ['chatgpt.com', 'chat.openai.com', 'claude.ai'];
        const isSupported = supportedSites.some(site => tab.url.includes(site));
        
        if (!isSupported) {
          console.warn('Background: Tab is not a supported chat site');
          sendResponse({ 
            status: 'Please open ChatGPT or Claude to test sounds',
            error: 'Test sounds only work on chat pages'
          });
          return;
        }
        
        const soundFile = message.soundFile || 'default.wav';
        const volume = message.volume || 0.7;
        
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (soundFile, volume) => {
            try {
              const audio = new Audio(chrome.runtime.getURL(`sounds/${soundFile}`));
              audio.volume = volume;
              audio.play()
                .then(null)
                .catch(e => console.error('Background test sound failed:', e));
            } catch (e) {
              console.error('Background test sound injection failed:', e);
            }
          },
          args: [soundFile, volume]
        }).then(() => {
          sendResponse({ status: 'Test sound played' });
        }).catch(error => {
            console.error('Background: Test sound injection error:', error);
            sendResponse({ 
                status: 'Test sound failed', 
                error: 'Please open ChatGPT or Claude to test sounds' 
            });
        });
      } else {
        sendResponse({ status: 'No active tab' });
      }
    });
    
    return true; // Keep message channel open for async response
  }
  
  // Handle other messages...
  return true;
});

