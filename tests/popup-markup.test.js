'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');

test('the popup contains every element used by its script', async () => {
  const [html, script] = await Promise.all([
    readFile('popup.html', 'utf8'),
    readFile('popup.js', 'utf8')
  ]);
  const ids = [...script.matchAll(/document\.getElementById\('([^']+)'\)/g)].map(match => match[1]);

  for (const id of new Set(ids)) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `popup.html is missing #${id}.`);
  }
});
