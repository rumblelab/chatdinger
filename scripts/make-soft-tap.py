#!/usr/bin/env python3
"""Create a short, original mallet tone without external samples."""

from pathlib import Path
import math
import struct
import wave


RATE = 48_000
DURATION = 0.70
OUTPUT = Path(__file__).resolve().parents[1] / "sounds" / "soft-tap.wav"

# All modes start together. There is one strike, with no pitch movement.
# The decay times are about three times longer than the 2.0.24 tap, so the
# strike rings for about half a second and is easier to hear from another tab.
MODES = (
    (523.25, 1.0, 0.200, 0.0035),
    (1046.50, 0.10, 0.110, 0.0025),
    (2077.30, 0.16, 0.060, 0.0020),
    (4704.02, 0.012, 0.025, 0.0015),
)

samples = []
for index in range(round(RATE * DURATION)):
    t = index / RATE
    value = sum(
        amplitude * (1 - math.exp(-t / attack)) * math.exp(-t / decay)
        * math.sin(2 * math.pi * frequency * t)
        for frequency, amplitude, decay, attack in MODES
    )
    tail = min(1.0, max(0.0, (DURATION - t) / 0.065))
    value *= math.sin(tail * math.pi / 2) ** 2
    samples.append(value)

gain = 10 ** (-11 / 20) / max(abs(value) for value in samples)
pcm = [round(value * gain * 32767) for value in samples]
pcm[0] = pcm[-1] = 0
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(OUTPUT), "wb") as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(RATE)
    output.writeframes(struct.pack(f"<{len(pcm)}h", *pcm))

print(OUTPUT)
