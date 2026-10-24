"""Synthesizes the mod's two chimes (soft bell tones, no samples): python -I tools/make-sounds.py clawd-bar/sounds"""
import math, struct, sys, wave

RATE = 22050


def bell(freq, start, dur, gain):
    # a struck bell: the note plus a quiet octave, decaying fast
    out = []
    for i in range(int(dur * RATE)):
        t = i / RATE
        env = math.exp(-t * 5.5) * min(1, t * 400)
        out.append((start + i, gain * env * (math.sin(2 * math.pi * freq * t) + 0.3 * math.sin(4 * math.pi * freq * t))))
    return out


def write(path, notes, length):
    buf = [0.0] * int(length * RATE)
    for freq, at, dur, gain in notes:
        for i, v in bell(freq, int(at * RATE), dur, gain):
            if i < len(buf):
                buf[i] += v
    peak = max(abs(v) for v in buf) or 1
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(v / peak * 0.5 * 32767)) for v in buf))


out = sys.argv[1]
write(f'{out}/wait.wav', [(880, 0, 0.9, 1), (659.25, 0.18, 1.0, 0.9)], 1.2)  # "your turn": a gentle falling two-note
write(f'{out}/done.wav', [(523.25, 0, 0.8, 0.8), (659.25, 0.12, 0.8, 0.8), (783.99, 0.24, 1.1, 1)], 1.4)  # "done": a rising chord
print('ok')
