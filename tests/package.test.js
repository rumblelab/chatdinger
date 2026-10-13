'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { promisify } = require('node:util');

const run = promisify(execFile);
const projectRoot = resolve(__dirname, '..');

test('the release ZIP contains only the package files', async t => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'chat-dinger-package-'));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const output = join(temporaryDirectory, 'chat-dinger.zip');

  await run('sh', ['scripts/package-extension.sh', output], { cwd: projectRoot });
  const { stdout } = await run('unzip', ['-Z1', output], { cwd: projectRoot });
  const files = stdout.trim().split('\n');

  for (const requiredFile of [
    'manifest.json',
    'shared.js',
    'detector.js',
    'background.js',
    'content.js',
    'popup.html',
    'popup.js',
    'popup-review.js',
    'onboarding.html',
    'onboarding.css',
    'onboarding.js',
    'LICENSE',
    'PRIVACY.md',
    'THIRD_PARTY_NOTICES.md',
    'images/gentlemansagreementfinal.jpeg',
    'sounds/cryptic.wav',
    'sounds/soft-tap.wav',
    'sounds/twelve.wav',
    'sounds/glitch.wav',
    'sounds/hmm.wav'
  ]) {
    assert.ok(files.includes(requiredFile), `${requiredFile} is missing from the ZIP.`);
  }

  for (const file of files) {
    assert.equal(file.includes('.git'), false, `${file} contains Git data.`);
    assert.equal(file.includes('.DS_Store'), false, `${file} contains macOS metadata.`);
    assert.equal(file.startsWith('tests/'), false, `${file} contains a test file.`);
  }

  for (const file of ['manifest.json', 'shared.js', 'detector.js', 'content.js', 'background.js', 'offscreen.js']) {
    const [{ stdout: packaged }, source] = await Promise.all([
      run('unzip', ['-p', output, file]),
      readFile(join(projectRoot, file), 'utf8')
    ]);
    assert.equal(packaged, source, `${file} differs from the tested source.`);
  }
});
