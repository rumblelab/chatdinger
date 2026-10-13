'use strict';
const { JSDOM } = require('jsdom');
const Detector = require('../../detector.js');
const Shared = require('../../shared.js');

module.exports = function harness(options = {}) {
  const dom = new JSDOM(options.html || '<main><form data-mobile-composer><textarea id="mobile-composer-prompt"></textarea><div data-composer-trailing><button data-composer-submit aria-label="Send message" hidden></button></div></form></main>', { url: 'https://chatgpt.com/' });
  const { window } = dom;
  const { document } = window;
  let entryNumber = 0;
  if (options.navigation) {
    const navigation = new window.EventTarget();
    navigation.currentEntry = { key: 'entry-0' };
    Object.defineProperty(window, 'navigation', { value: navigation });
  }
  function entryChange(path, navigationType, key) {
    const from = window.navigation.currentEntry;
    window.history[navigationType === 'replace' ? 'replaceState' : 'pushState']({}, '', path);
    window.navigation.currentEntry = { key: key ?? (navigationType === 'replace' ? from.key : `entry-${++entryNumber}`) };
    const event = new window.Event('currententrychange');
    Object.defineProperties(event, { navigationType: { value: navigationType }, from: { value: from } });
    window.navigation.dispatchEvent(event);
  }
  window.HTMLElement.prototype.getClientRects = function () {
    return this.isConnected && this.style.display !== 'none' ? [{}] : [];
  };
  let time = 1000, nextId = 1;
  const timers = new Map();
  window.setTimeout = (fn, delay = 0) => { const id = nextId++; timers.set(id, { fn, at: time + delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  window.setInterval = (fn, period) => { const id = nextId++; timers.set(id, { fn, at: time + period, period }); return id; };
  window.clearInterval = window.clearTimeout;
  const completions = [], health = [], refreshes = [];
  const detector = Detector.create({ document, window, getButtonState: Shared.getChatGPTButtonState,
    now: () => time, onComplete: duration => completions.push(duration), onHealth: value => health.push(value),
    refresh: async () => { refreshes.push(time); return options.refresh ? options.refresh() : { success: false }; } });
  function tick(milliseconds) {
    const end = time + milliseconds;
    for (let count = 0; count < 10000; count++) {
      const due = [...timers].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, item] = due;
      time = item.at;
      if (item.period) item.at += item.period;
      else timers.delete(id);
      item.fn();
    }
    time = end;
  }
  async function flush() { for (let i = 0; i < 10; i++) { await Promise.resolve(); tick(0); } }
  async function advance(ms) { await flush(); tick(ms); await flush(); }
  function busy(button = document.querySelector('[data-composer-submit]')) {
    button.type = 'button';
    button.hidden = false;
    button.setAttribute('aria-label', 'Stop generating');
    button.setAttribute('data-stop-generating', '');
  }
  function idle(button = document.querySelector('[data-composer-submit]')) {
    button.type = 'submit';
    button.hidden = true;
    button.setAttribute('aria-label', 'Send message');
    button.removeAttribute('data-stop-generating');
  }
  detector.start();
  return { dom, window, document, detector, completions, health, refreshes, advance, flush, busy, idle, entryChange,
    close() { detector.stop(); window.close(); } };
};
