'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
const Shared = require('../shared.js');
const config = JSON.parse(readFileSync('selectors.json', 'utf8'));

function composer(label) {
  return new JSDOM(`<div data-composer-footer-responsive>
    <div contenteditable="true" role="textbox" data-composer-markdown class="ProseMirror" aria-label="Ask ChatGPT"></div>
    <div class="flex shrink-0 items-center gap-2">
      <div class="flex items-center"><span class="contents">
        <button class="flex items-center gap-1" aria-label="Dictate"></button>
      </span></div>
      <div class="flex items-center">
        <button class="flex items-center bg-composer-primary" aria-label="${label}"></button>
      </div>
    </div>
  </div>`);
}

test('the remote config stays within version 2.0.21 selector limits', () => {
  assert.ok(Shared.validateSelectorConfig(config));
  assert.ok(config.mainButtonSelectors.length <= 12);
  for (const selector of [...config.mainButtonSelectors, ...Object.values(config.muteToggleSelectors)]) {
    assert.ok(selector.length <= 240);
  }
});

for (const label of ['Start Voice', 'Stop', 'Send']) {
  test(`remote selectors match the signed-in ${label} control`, () => {
    const dom = composer(label);
    const { document } = dom.window;
    const matches = [...new Set(config.mainButtonSelectors.flatMap(selector => [...document.querySelectorAll(selector)]))];
    assert.equal(matches.length, 1);
    assert.equal(matches[0].getAttribute('aria-label'), label);
    assert.equal(Shared.getChatGPTButtonState(matches[0]).isGenerating, label === 'Stop');
    assert.equal(Shared.getChatGPTButtonState(matches[0]).isIdle, label !== 'Stop');
    dom.window.close();
  });
}

test('the mute wrapper is an ancestor, not the dictation button', () => {
  const dom = composer('Start Voice');
  const button = dom.window.document.querySelector(config.muteToggleSelectors.dictateButton);
  assert.equal(button.getAttribute('aria-label'), 'Dictate');
  const wrapper = button.closest(config.muteToggleSelectors.flexWrapper);
  assert.ok(wrapper);
  assert.notEqual(wrapper, button);
  assert.equal(wrapper.tagName, 'DIV');
  assert.ok(wrapper.contains(button));
  dom.window.close();
});
