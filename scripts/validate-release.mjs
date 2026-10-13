import { access, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const packageFile = JSON.parse(await readFile('package.json', 'utf8'));
await import('../shared.js');
const errors = [];

if (manifest.manifest_version !== 3) {
  errors.push('manifest_version must be 3.');
}

if (Number.parseInt(manifest.minimum_chrome_version, 10) < 116) {
  errors.push('minimum_chrome_version must support the Promise-based notification API.');
}

if (manifest.version !== packageFile.version) {
  errors.push('The package and manifest versions must match.');
}

if (typeof manifest.name !== 'string' || manifest.name.trim().length === 0) {
  errors.push('The manifest name must not be empty.');
} else if (manifest.name.length > 75) {
  errors.push(`The manifest name has ${manifest.name.length} characters. The maximum is 75.`);
}

if (typeof manifest.description !== 'string' || manifest.description.trim().length === 0) {
  errors.push('The manifest description must not be empty.');
} else if (manifest.description.length > 132) {
  errors.push(`The manifest description has ${manifest.description.length} characters. The maximum is 132.`);
}

const referencedFiles = new Set([
  'popup-review.js', 'popup.css', 'metrics.js', 'onboarding.html', 'onboarding.css', 'onboarding.js',
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {}),
  ...(manifest.content_scripts || []).flatMap((entry) => entry.js || []),
  ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || [])
].filter(Boolean));

for (const sound of globalThis.ChatDingerShared.SOUND_FILES) {
  referencedFiles.add(`sounds/${sound.value}`);
}

for (const file of referencedFiles) {
  try {
    await access(file);
  } catch {
    errors.push(`The manifest references a missing file: ${file}`);
  }
}

const forbiddenPermissions = new Set(['activeTab']);
for (const permission of manifest.permissions || []) {
  if (forbiddenPermissions.has(permission)) {
    errors.push(`Remove the unused permission: ${permission}`);
  }
}

const insecureMatches = [
  ...(manifest.host_permissions || []),
  ...(manifest.content_scripts || []).flatMap((entry) => entry.matches || []),
  ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.matches || [])
].filter((match) => match.startsWith('*://'));

if (insecureMatches.length > 0) {
  errors.push(`Use HTTPS-only match patterns: ${insecureMatches.join(', ')}`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exitCode = 1;
} else {
  console.log(`Release files are valid for version ${manifest.version}.`);
}
