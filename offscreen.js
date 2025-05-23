// Offscreen document for reliable audio playback
class AudioManager {
    constructor() {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.init();
    }
  
    init() {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'playAudio') {
          if (request.type === 'completion') {
            this.playCompletionSound();
          } else if (request.type === 'error') {
            this.playErrorSound();
          }
          sendResponse({ success: true });
        }
        return true;
      });
    }
  
    playCompletionSound() {
      // Create a pleasant multi-tone ding
      const frequencies = [659.25, 783.99, 987.77]; // E5, G5, B5
      const startTime = this.audioContext.currentTime;
      
      frequencies.forEach((freq, index) => {
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, startTime + index * 0.1);
        
        gainNode.gain.setValueAtTime(0, startTime + index * 0.1);
        gainNode.gain.linearRampToValueAtTime(0.2, startTime + index * 0.1 + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + index * 0.1 + 0.4);
        
        oscillator.start(startTime + index * 0.1);
        oscillator.stop(startTime + index * 0.1 + 0.4);
      });
    }
  
    playErrorSound() {
      // Create a distinct error sound
      const oscillator1 = this.audioContext.createOscillator();
      const oscillator2 = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      
      oscillator1.connect(gainNode);
      oscillator2.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      
      // Create dissonant frequencies for error indication
      oscillator1.type = 'square';
      oscillator2.type = 'square';
      oscillator1.frequency.setValueAtTime(220, this.audioContext.currentTime);
      oscillator2.frequency.setValueAtTime(233, this.audioContext.currentTime); // Slightly off for dissonance
      
      oscillator1.frequency.linearRampToValueAtTime(110, this.audioContext.currentTime + 0.5);
      oscillator2.frequency.linearRampToValueAtTime(116.5, this.audioContext.currentTime + 0.5);
      
      gainNode.gain.setValueAtTime(0.15, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.6);
      
      oscillator1.start(this.audioContext.currentTime);
      oscillator2.start(this.audioContext.currentTime);
      oscillator1.stop(this.audioContext.currentTime + 0.6);
      oscillator2.stop(this.audioContext.currentTime + 0.6);
    }
  }
  
  // Initialize audio manager
  new AudioManager();