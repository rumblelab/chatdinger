# Ready

An original notification cue for Chat Dinger. It uses synthesized tones and no external samples.

The cue has two short tones, a soft attack, and a quick fade. Its duration is 0.38 seconds.
The design aims to signal a completed response during a call without a long ring or a sharp click.
Its comfort and audibility need a listening check with the user's headset and normal call volume.

The file is mono, 48 kHz, 16-bit PCM WAV. Its peak level is -10 dBFS.
The source is `scripts/make-ready-sound.py`.

Ready is an unused listening preview. It is not in the extension package.

## Soft tap

The selected sound uses one mallet strike with a rounded attack.
Version 2.0.29 makes the decay about three times longer. The strike now rings for about half a second and the file lasts 0.70 seconds.
The 2.0.24 tap lasted 0.30 seconds. That file stays here as `soft-tap.wav` for comparison.
Soft tap has a lower pitch than Ready.
The file is mono, 48 kHz, 16-bit PCM WAV, with a peak level of -11 dBFS.
The source is `scripts/make-soft-tap.py`. It uses no external samples.

The packaged file is `sounds/soft-tap.wav`. The generator writes to that file.
Version 2.0.24 includes Soft tap in setup and Settings. It is the default for new installs.
Existing users keep their saved sound. The original listening preview remains here for comparison.
