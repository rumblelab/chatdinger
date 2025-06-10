chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'playOffscreenAudio') {
      playAudio(message.soundFile, message.volume);
    }
  });
  
  // The actual audio playback function
  function playAudio(soundFile, volume) {
    const audio = new Audio(`sounds/${soundFile}`);
    audio.volume = volume;
    audio.play().catch(e => console.error(`Offscreen Audio Error: ${e.message}`));
  }