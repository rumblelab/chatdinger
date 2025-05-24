// Updated background script with settings support
console.log('ChatGPT Alert: Background script loaded with settings support');

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background: Received message:', message);
  
  if (message.action === 'testSound') {
    console.log('Background: Test sound requested');
    
    // Play test sound by injecting into active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const soundFile = message.soundFile || 'alert.mp3';
        const volume = message.volume || 0.7;
        
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: (soundFile, volume) => {
            try {
              const audio = new Audio(chrome.runtime.getURL(`sounds/${soundFile}`));
              audio.volume = volume;
              audio.play()
                .then(() => console.log('Background test sound played successfully'))
                .catch(e => console.error('Background test sound failed:', e));
            } catch (e) {
              console.error('Background test sound injection failed:', e);
            }
          },
          args: [soundFile, volume]
        }).then(() => {
          console.log('Background: Test sound injection successful');
          sendResponse({ status: 'Test sound played' });
        }).catch(error => {
          console.error('Background: Test sound injection failed:', error);
          sendResponse({ status: 'Test sound failed', error: error.message });
        });
      } else {
        console.error('Background: No active tab for test sound');
        sendResponse({ status: 'No active tab' });
      }
    });
    
    return true; // Keep message channel open for async response
  }
  
  // Handle other messages...
  return true;
});

console.log("ChatGPT Alert: Background script ready");