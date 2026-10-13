'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

function makeHarness(options = {}) {
  const audios = [];
  const timers = [];
  let listener;
  class Audio {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.pauseCalls = 0;
      this.currentTime = 0;
      audios.push(this);
    }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    removeEventListener(name, callback) {
      if (this.listeners.get(name) === callback) this.listeners.delete(name);
    }
    emit(name) { this.listeners.get(name)?.(); }
    play() {
      if (options.play) return options.play(this, audios.length);
      return Promise.resolve();
    }
    pause() {
      this.pauseCalls += 1;
      if (options.pause) options.pause(this);
    }
  }
  const context = vm.createContext({
    Audio,
    console: { error() {} },
    chrome: { runtime: {
      id: 'test-extension',
      getURL: path => `chrome-extension://test-extension/${path}`,
      onMessage: { addListener(value) { listener = value; } }
    } },
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { timer.cleared = true; }
  });
  vm.runInContext(readFileSync(join(__dirname, '..', 'shared.js'), 'utf8'), context);
  vm.runInContext(readFileSync(join(__dirname, '..', 'offscreen.js'), 'utf8'), context);
  const dispatch = (message = {}, sender = { id: 'test-extension' }) => new Promise(resolve => {
    const active = listener({ target: 'offscreen', action: 'playOffscreenAudio', soundFile: 'ding.mp3', volume: .7, ...message }, sender,
      response => resolve(structuredClone(response)));
    if (active === false) resolve(undefined);
  });
  return { audios, timers, dispatch };
}

test('the offscreen player confirms a started sound and removes listeners when it ends', async () => {
  const { audios, timers, dispatch } = makeHarness();
  const result = await dispatch();
  assert.deepEqual(result, { success: true, audioStarted: true });
  assert.equal(timers[0].cleared, true);
  assert.equal(audios[0].volume, .7);
  audios[0].emit('ended');
  assert.equal(audios[0].listeners.size, 0);
  await dispatch();
  assert.equal(audios[0].pauseCalls, 0);
});

for (const synchronous of [false, true]) {
  test(`a ${synchronous ? 'synchronous' : 'rejected'} playback error returns audio_failed and removes listeners`, async () => {
    const { audios, timers, dispatch } = makeHarness({ play() {
      if (synchronous) throw new Error('Playback failed.');
      return Promise.reject(new Error('Playback failed.'));
    } });
    const result = await dispatch();
    assert.equal(result.success, false);
    assert.equal(result.code, 'audio_failed');
    assert.equal(result.audioStarted, false);
    assert.equal(audios[0].listeners.size, 0);
    assert.equal(timers[0].cleared, true);
  });
}

test('a media error reports failure even if the play promise remains pending', async () => {
  const { audios, timers, dispatch } = makeHarness({ play: () => new Promise(() => {}) });
  const pending = dispatch();
  audios[0].emit('error');
  const result = await pending;
  assert.equal(result.code, 'audio_failed');
  assert.equal(audios[0].listeners.size, 0);
  assert.equal(timers[0].cleared, true);
});

test('a sound that never starts returns failure after the start timeout', async () => {
  const { audios, timers, dispatch } = makeHarness({ play: () => new Promise(() => {}) });
  const pending = dispatch();
  assert.equal(timers[0].delay, 10000);
  timers[0].callback();
  const result = await pending;
  assert.equal(result.code, 'audio_failed');
  assert.equal(audios[0].pauseCalls, 1);
  assert.equal(audios[0].listeners.size, 0);
});

test('a new alert can replace a pending sound without a false audio failure', async () => {
  const { audios, dispatch } = makeHarness({
    play(audio, count) {
      if (count === 1) return new Promise((resolve, reject) => { audio.rejectStart = reject; });
      return Promise.resolve();
    },
    pause(audio) { audio.rejectStart?.(new Error('AbortError: Playback was interrupted.')); }
  });
  const first = dispatch();
  const second = dispatch();
  assert.deepEqual(await first, { success: true, skipped: true, skipReason: 'superseded', audioStarted: false });
  assert.deepEqual(await second, { success: true, audioStarted: true });
  assert.equal(audios[0].pauseCalls, 1);
  assert.equal(audios[0].listeners.size, 0);
  assert.equal(audios[1].listeners.size, 2);
  audios[1].emit('ended');
  assert.equal(audios[1].listeners.size, 0);
});

test('a media error after a sound starts releases the player reference', async () => {
  const { audios, dispatch } = makeHarness();
  await dispatch();
  audios[0].emit('error');
  await dispatch();
  assert.equal(audios[0].listeners.size, 0);
  assert.equal(audios[0].pauseCalls, 0);
});

test('the offscreen player rejects page senders and unlisted sounds', async () => {
  const { audios, dispatch } = makeHarness();
  assert.equal((await dispatch({}, { id: 'test-extension', tab: { id: 1 } })).success, false);
  assert.equal((await dispatch({}, { id: 'other-extension' })).success, false);
  const invalid = await dispatch({ soundFile: 'https://example.test/audio.mp3' });
  assert.equal(invalid.code, 'audio_failed');
  assert.equal(audios.length, 0);
});
