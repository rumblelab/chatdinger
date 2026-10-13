'use strict';

const { SOUND_FILES, clampVolume } = ChatDingerShared;
const soundValues = SOUND_FILES.map(sound => sound.value);
const AUDIO_START_TIMEOUT_MS = 10000;
let currentPlayback = null;

async function playAudio(soundFile, volume) {
  if (!soundValues.includes(soundFile)) {
    throw new Error('The sound file is not permitted.');
  }

  const audio = new Audio(chrome.runtime.getURL(`sounds/${soundFile}`));
  audio.volume = clampVolume(volume);
  audio.preload = 'auto';
  if ('preservesPitch' in audio) {
    audio.preservesPitch = false;
  }
  if (currentPlayback) {
    currentPlayback.replace();
  }

  return new Promise((resolve, reject) => {
    let startSettled = false;
    const playback = { replace };
    const cleanup = () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      if (currentPlayback === playback) currentPlayback = null;
    };
    const settleStart = (error, result) => {
      if (startSettled) return;
      startSettled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    };
    const onEnded = () => {
      settleStart(null, { success: true, audioStarted: true });
      cleanup();
    };
    const onError = () => {
      settleStart(new Error('The audio player could not read the sound file.'));
      cleanup();
    };
    function replace() {
      // A new alert can replace a sound whose play request is still pending.
      settleStart(null, { success: true, skipped: true, skipReason: 'superseded', audioStarted: false });
      cleanup();
      audio.pause();
      audio.currentTime = 0;
    }
    const timeout = setTimeout(() => {
      settleStart(new Error('The sound did not start within ten seconds.'));
      cleanup();
      audio.pause();
    }, AUDIO_START_TIMEOUT_MS);
    currentPlayback = playback;
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    try {
      Promise.resolve(audio.play()).then(() => {
        settleStart(null, { success: true, audioStarted: true });
      }, error => {
        settleStart(error);
        cleanup();
      });
    } catch (error) {
      settleStart(error);
      cleanup();
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen' || message.action !== 'playOffscreenAudio') {
    return false;
  }
  if (sender.id !== chrome.runtime.id || sender.tab) {
    sendResponse({ success: false, error: 'This sender cannot use the audio player.' });
    return false;
  }

  playAudio(message.soundFile, message.volume)
    .then(sendResponse)
    .catch(error => {
      console.error('Chat Dinger: Offscreen audio failed.', error);
      sendResponse({ success: false, code: 'audio_failed', audioStarted: false, error: error.message });
    });
  return true;
});
