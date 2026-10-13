#!/bin/sh
set -eu

version="$(node -p "require('./manifest.json').version")"
output="${1:-dist/chat-dinger-${version}.zip}"
output_dir="$(dirname "$output")"

mkdir -p "$output_dir"
rm -f "$output"

zip -q -r "$output" \
  manifest.json \
  shared.js \
  metrics.js \
  detector.js \
  background.js \
  content.js \
  offscreen.html \
  offscreen.js \
  popup.html \
  popup.css \
  popup.js \
  popup-review.js \
  onboarding.html \
  onboarding.css \
  onboarding.js \
  LICENSE \
  PRIVACY.md \
  THIRD_PARTY_NOTICES.md \
  images \
  sounds \
  -x '*/.DS_Store'

unzip -t "$output"
echo "Created $output"
