async function logIfDev(level, ...args) {
  if (!chrome.runtime?.id||!chrome.storage?.local) {
    // The context has been invalidated, so we can't use any chrome.* APIs.
    // Silently return to prevent the error.
    return;
  }
  try {
    const { isDevMode } = await chrome.storage.local.get(['isDevMode']);
    if (isDevMode) {
      switch (level) {
        case 'log':
          console.log('Chat Dinger:', ...args);
          break;
        case 'warn':
          console.warn('Chat Dinger:', ...args);
          break;
        case 'error':
          console.error('Chat Dinger:', ...args);
          break;
      }
    }
  } catch (e) {
    console.error('Chat Dinger: Failed to check dev mode for logging:', e.message);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'playOffscreenAudio') {
    logIfDev('log', `Received play request for ${message.soundFile}`);
    playAudio(message.soundFile, message.volume);
  }
});

function playAudio(soundFile, volume) {
  logIfDev('log', `Playing ${soundFile} at volume ${volume}`);
  const audio = new Audio(chrome.runtime.getURL(`sounds/${soundFile}`));
  audio.volume = volume;
  audio.play().catch(e => console.error(`Offscreen Audio Error: ${e.message}`));
}