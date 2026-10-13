#!/usr/bin/env python3
"""Create the original Chat Dinger Ready sound without external samples."""

from pathlib import Path
import math
import struct
import wave


RATE = 48_000
DURATION = 0.38
PEAK_DBFS = -10.0
OUTPUT = Path(__file__).resolve().parents[1] / "sound-design" / "ready.wav"


def note(t, frequency, decay):
    if t < 0:
        return 0.0
    # A rounded attack and a small pitch settle give the tone a soft pluck.
    attack = 1.0 - math.exp(-t / 0.0045)
    envelope = attack * math.exp(-t / decay)
    phase = 2 * math.pi * (frequency * t + 11 * 0.009 * (1 - math.exp(-t / 0.009)))
    body = math.sin(phase)
    body += 0.12 * math.exp(-t / 0.032) * math.sin(2.01 * phase)
    body += 0.022 * math.exp(-t / 0.012) * math.sin(3.02 * phase)
    return envelope * body


samples = []
for index in range(round(RATE * DURATION)):
    t = index / RATE
    sample = 0.63 * note(t, 696, 0.047)
    sample += note(t - 0.085, 928, 0.063)
    # Bring the remaining tail to zero without an abrupt cut.
    end_fade = min(1.0, max(0.0, (DURATION - t) / 0.045))
    sample *= math.sin(end_fade * math.pi / 2) ** 2
    samples.append(sample)

gain = 10 ** (PEAK_DBFS / 20) / max(abs(value) for value in samples)
pcm = [round(value * gain * 32767) for value in samples]
pcm[0] = pcm[-1] = 0
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(OUTPUT), "wb") as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(RATE)
    output.writeframes(struct.pack(f"<{len(pcm)}h", *pcm))

print(OUTPUT)
