#!/usr/bin/env python3
"""Build the web game's audio set (OGG Vorbis) + audio.json.

Sources
- Julgen rip (assets-src/julgen/SFX): 44.1 kHz 16-bit, mono content in stereo files,
  unnamed and padded with ~1 s of silence. Identification: tools/audio_identification.md.
- The Bub's Brothers (assets-src/bubbros-1.6.2/bubbob): 8-bit unsigned mono WAVs.

Processing
- SFX: mono, DC removal, trim silence (10 ms pre-roll, 30 ms fade on the tail gate),
  8-bit sources are denoised (afftdn), resampled with soxr to 44.1 kHz and low-passed
  below the source Nyquist; loudness-matched on max momentary loudness (-16 LUFS),
  peaks capped at -1 dBFS. OGG Vorbis q5.
- Music: 8-bit tracks denoised + upsampled + gentle treble EQ, normalised to -14 LUFS
  integrated with a -1 dBFS limiter. Explicit loops are baked: the file ends at loopEnd
  and its last 40 ms are cross-faded with the audio just before loopStart, so a
  sample-accurate WebAudio loop (loopStart..loopEnd) is seamless. OGG Vorbis q6.

Usage (from the repo root):
  python3 tools/build_audio.py --src-bubbros assets-src/bubbros-1.6.2 \
      --src-julgen assets-src/julgen/SFX --out public/assets/audio [--check DIR]
"""
import argparse
import json
import pathlib
import subprocess
import warnings

import numpy as np
from scipy import signal
from scipy.io import wavfile

warnings.filterwarnings("ignore", category=wavfile.WavFileWarning)

ROOT = pathlib.Path(__file__).resolve().parent.parent
SR = 44100
SFX_TARGET_LUFS = -16.0
MUSIC_TARGET_LUFS = -14.0
PEAK_DBFS = -1.0

# event -> (julgen file, confidence). Only high/med replace a Bub&Bros sound.
JULGEN_SFX = {
    "jump": ("Jump.wav", "high"),
    "shoot": ("Bubble Bobble SFX (2).wav", "med"),
    "pop": ("Bubble Bobble SFX (1).wav", "med"),
    "fruit": ("Bubble Bobble SFX (5).wav", "med"),
    "kill": ("Bubble Bobble SFX (3).wav", "low"),
    "capture": ("Bubble Bobble SFX (4).wav", "low"),
    "letter": ("Bubble Bobble SFX (6).wav", "low"),
    "coin": ("Bubble Bobble SFX (7).wav", "low"),
    "sparkle": ("Bubble Bobble SFX (8).wav", "low"),
    "appear": ("Bubble Bobble SFX (10).wav", "low"),
    "alarm": ("Bubble Bobble SFX (11).wav", "low"),
    "bell": ("Bubble Bobble SFX (12).wav", "low"),
    "spin": ("Bubble Bobble SFX (13).wav", "low"),
    "chain": ("Bubble Bobble SFX (14).wav", "low"),
    "fire": ("Bubble Bobble SFX (15).wav", "low"),
    "special": ("Bubble Bobble SFX (16).wav", "low"),
    "spin_long": ("Bubble Bobble SFX (17).wav", "low"),
    "lightning": ("Bubble Bobble SFX (18).wav", "low"),
    "water": ("Bubble Bobble SFX (19).wav", "low"),
    "fanfare": ("Bubble Bobble SFX (20).wav", "low"),
    "jingle": ("Bubble Bobble SFX (21).wav", "low"),
}

# event -> path relative to bubbob/
BUBBROS_SFX = {
    "jump": "sounds/jump.wav", "pop": "sounds/pop.wav", "fruit": "sounds/fruit.wav",
    "extra": "sounds/extra.wav", "extralife": "sounds/extralife.wav",
    "yippee": "sounds/yippee.wav", "hurry": "sounds/hurry.wav", "hell": "sounds/hell.wav",
    "letsgo": "sounds/letsgo.wav", "die": "sounds/die.wav", "shh": "sounds/shh.wav",
    "ext1_wall": "ext1/wall.wav", "ext1_brick": "ext1/brick.wav", "ext3_shoot": "ext3/shoot.wav",
    "ext5_ouch": "ext5/ouch.wav", "ext6_crash": "ext6/crash.wav", "ext7_fire": "ext7/fire.wav",
    "ext7_hit": "ext7/hit.wav",
}

# name -> (source, loop). loop: None = one-shot, "whole" = loop the whole file (as the
# original game did), or (approx lag s, search window for loopStart (a, b) s in the
# source timeline) -> refined to sample accuracy and baked.
MUSIC = {
    "main": ("julgen:The Quest Begins.ogg", (89.4634, (56.0, 70.0))),
    "intro": ("music/Snd1-8.wav", None),
    "main_mac": ("music/Snd2-8.wav", "whole"),
    "potion": ("music/Snd3-8.wav", "whole"),
    "modern": ("music/Snd4-8.wav", None),
    "extend": ("music/Snd5-8.wav", None),
    "main2": ("music/Snd6-8.wav", (179.34, (8.0, 40.0))),
    **{f"ext{i}": (f"ext{i}/music.wav", "whole") for i in range(1, 8)},
}
MUSIC_VOLUME = 0.8


# ---------------------------------------------------------------- I/O helpers
def ffmpeg_decode(path, filters=None, channels=None):
    """Decode any file to float32 at SR, optionally through an ffmpeg filter chain."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path)]
    af = list(filters or [])
    af.append(f"aresample={SR}:resampler=soxr:precision=28")
    cmd += ["-af", ",".join(af)]
    if channels:
        cmd += ["-ac", str(channels)]
    cmd += ["-f", "f32le", "-acodec", "pcm_f32le", "-"]
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                            "stream=channels", "-of", "csv=p=0", str(path)],
                           capture_output=True, text=True, check=True)
    ch = channels or int(probe.stdout.strip())
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64).reshape(-1, ch)


def encode_ogg(x, path, quality):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = np.clip(x, -1, 1).astype(np.float32)
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", str(data.shape[1]),
           "-i", "-", "-c:a", "libvorbis", "-q:a", str(quality), "-map_metadata", "-1", str(path)]
    subprocess.run(cmd, input=data.tobytes(), check=True)


# ---------------------------------------------------------------- loudness (BS.1770)
def _biquad_shelf(sr):
    G, Q, fc = 3.99984385397, 0.7071752369554193, 1681.9744509555319
    A = 10 ** (G / 40)
    w0 = 2 * np.pi * fc / sr
    alpha = np.sin(w0) / (2 * Q)
    cw = np.cos(w0)
    b = [A * ((A + 1) + (A - 1) * cw + 2 * np.sqrt(A) * alpha), -2 * A * ((A - 1) + (A + 1) * cw),
         A * ((A + 1) + (A - 1) * cw - 2 * np.sqrt(A) * alpha)]
    a = [(A + 1) - (A - 1) * cw + 2 * np.sqrt(A) * alpha, 2 * ((A - 1) - (A + 1) * cw),
         (A + 1) - (A - 1) * cw - 2 * np.sqrt(A) * alpha]
    return np.array(b) / a[0], np.array(a) / a[0]


def _biquad_hp(sr):
    Q, fc = 0.5003270373238773, 38.13547087602444
    w0 = 2 * np.pi * fc / sr
    alpha = np.sin(w0) / (2 * Q)
    cw = np.cos(w0)
    b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
    a = [1 + alpha, -2 * cw, 1 - alpha]
    return np.array(b) / a[0], np.array(a) / a[0]


def k_weight(x):
    b1, a1 = _biquad_shelf(SR)
    b2, a2 = _biquad_hp(SR)
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=0), axis=0)


def _block_power(x, win, hop):
    y = k_weight(x)
    p = (y ** 2).sum(axis=1)
    if len(p) < win:
        p = np.pad(p, (0, win - len(p)))
    c = np.concatenate([[0], np.cumsum(p)])
    starts = np.arange(0, len(p) - win + 1, hop)
    return (c[starts + win] - c[starts]) / win


def lufs_integrated(x):
    z = _block_power(x, int(0.4 * SR), int(0.1 * SR))
    l = -0.691 + 10 * np.log10(z + 1e-12)
    z = z[l > -70]
    rel = -0.691 + 10 * np.log10(z.mean() + 1e-12) - 10
    z = z[-0.691 + 10 * np.log10(z + 1e-12) > rel]
    return -0.691 + 10 * np.log10(z.mean() + 1e-12)


def lufs_max_momentary(x):
    z = _block_power(x, int(0.4 * SR), int(0.01 * SR))
    return -0.691 + 10 * np.log10(z.max() + 1e-12)


def db(v):
    return 20 * np.log10(max(v, 1e-12))


# ---------------------------------------------------------------- processing
def dc_block(x, fc=20.0):
    sos = signal.butter(2, fc, "highpass", fs=SR, output="sos")
    return signal.sosfiltfilt(sos, x, axis=0)


def gate_trim(x, thresh_db=-45.0, preroll=0.010, fade=0.030):
    """Trim leading/trailing parts quieter than peak+thresh_db (10 ms RMS envelope)."""
    mono = np.abs(x).max(axis=1)
    win = int(0.010 * SR)
    env = np.sqrt(np.convolve(mono ** 2, np.ones(win) / win, "same"))
    above = np.where(env > env.max() * 10 ** (thresh_db / 20))[0]
    s = max(0, above[0] - int(preroll * SR) - win // 2)
    e = min(len(x), above[-1] + win)
    y = x[s:e].copy()
    nf = min(int(fade * SR), len(y) // 4)
    y[-nf:] *= np.linspace(1, 0, nf)[:, None] ** 2
    ni = min(int(0.002 * SR), len(y) // 8)
    y[:ni] *= np.linspace(0, 1, ni)[:, None]
    return y


def normalize_sfx(x):
    g = SFX_TARGET_LUFS - lufs_max_momentary(x)
    g = min(g, PEAK_DBFS - db(np.abs(x).max()))
    return x * 10 ** (g / 20)


def eightbit_filters(src_sr, music):
    """ffmpeg chain for 8-bit sources (runs at the source rate, before soxr upsampling)."""
    nr = 10 if music else 14
    f = ["aformat=sample_fmts=flt", "highpass=f=20:p=2", f"afftdn=nr={nr}:nf=-50:nt=w"]
    return f


def post_lowpass(x, src_sr, music):
    """Gentle low-pass under the source Nyquist + slight treble shelf (aliasing / hiss)."""
    fc = min(0.45 * src_sr, 12000.0 if music else 10000.0)
    sos = signal.butter(2, fc, "lowpass", fs=SR, output="sos")
    y = signal.sosfiltfilt(sos, x, axis=0)
    if music and src_sr >= 44100:
        # -2.5 dB high shelf from ~7 kHz: tames the harsh 8-bit/aliasing top end
        sos2 = signal.butter(1, 7000, "lowpass", fs=SR, output="sos")
        low = signal.sosfiltfilt(sos2, y, axis=0)
        y = low + (y - low) * 10 ** (-2.5 / 20)
    return y


def src_rate(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                          "stream=sample_rate", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True)
    return int(out.stdout.strip())


def load_8bit(path, music, circular=False):
    """Denoise + upsample an 8-bit file. circular=True processes the file as a loop
    (three copies, middle one kept) so filters/denoiser have no edge effects at the wrap."""
    sr0 = src_rate(path)
    if not circular:
        x = ffmpeg_decode(path, eightbit_filters(sr0, music), channels=1)
        return post_lowpass(dc_block(x), sr0, music), sr0
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    tiled = np.tile(np.frombuffer(raw, np.float32), 3)
    n = len(tiled) // 3
    af = ",".join(eightbit_filters(sr0, music) + [f"aresample={SR}:resampler=soxr:precision=28"])
    out = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(sr0), "-ac", "1", "-i", "-",
                          "-af", af, "-f", "f32le", "-"], input=tiled.tobytes(),
                         capture_output=True, check=True).stdout
    y = np.frombuffer(out, np.float32).astype(np.float64)[:, None]
    y = post_lowpass(dc_block(y), sr0, music)
    m = n * SR // sr0
    return y[m:2 * m], sr0


def smooth_wrap(x, ms=4.0):
    """Ramp the last few ms so the sample after the end (= first sample) is continuous."""
    k = int(ms / 1000 * SR)
    jump = x[0] - x[-1]
    x = x.copy()
    x[-k:] += jump * np.linspace(0, 1, k + 1)[1:, None]
    return x


def load_8bit_raw(path):
    return ffmpeg_decode(path, ["aformat=sample_fmts=flt"], channels=1)


# ---------------------------------------------------------------- loops
def refine_loop(x, lag, window, xfade=0.040):
    """Find loopStart in window (s) maximising waveform similarity of x[s-w:s] and
    x[s+lag-w:s+lag]; refine the lag to the sample. Returns (start, end) samples."""
    m = x.mean(axis=1)
    lagn = int(round(lag * SR))
    w = int(0.25 * SR)
    a0, a1 = int(window[0] * SR), int(min(window[1] * SR, len(m) - lagn - w - 1))
    best = (-2.0, a0, lagn)
    step = int(0.01 * SR)
    for s in range(a0 + w, a1, step):
        a = m[s - w:s]
        srch = int(0.02 * SR)
        b = m[s + lagn - w - srch:s + lagn + srch]
        c = signal.correlate(b, a, "valid")
        k = int(np.argmax(c))
        seg = b[k:k + w]
        nc = np.dot(a, seg) / np.sqrt(np.dot(a, a) * np.dot(seg, seg) + 1e-12)
        if nc > best[0]:
            best = (nc, s, lagn - srch + k)
    nc, s, L = best
    # fine: choose the exact start in +-5 ms minimising local difference at the seam
    n = int(0.005 * SR)
    cand = range(s - n, s + n)
    errs = [np.sum((m[c - 64:c + 64] - m[c + L - 64:c + L + 64]) ** 2) for c in cand]
    s = list(cand)[int(np.argmin(errs))]
    return s, s + L, nc


def bake_loop(x, start, end, xfade=0.040):
    """Return x[:end] whose last xfade seconds blend into x[start-xfade:start]."""
    n = int(xfade * SR)
    y = x[:end].copy()
    t = np.linspace(0, 1, n)[:, None]
    fade_out = np.cos(t * np.pi / 2)
    fade_in = np.sin(t * np.pi / 2)
    y[end - n:end] = x[end - n:end] * fade_out + x[start - n:start] * fade_in
    return y


def limit(x, ceiling_db=PEAK_DBFS):
    """Simple look-ahead peak limiter (gain envelope = min over 5 ms, 80 ms release)."""
    ceil = 10 ** (ceiling_db / 20)
    peak = np.abs(x).max(axis=1)
    if peak.max() <= ceil:
        return x
    need = np.minimum(1.0, ceil / np.maximum(peak, 1e-12))
    la = int(0.005 * SR)
    from scipy.ndimage import minimum_filter1d
    g = minimum_filter1d(need, size=2 * la + 1)
    # release smoothing (one-pole, only upward)
    rel = np.exp(-1 / (0.08 * SR))
    out = np.empty_like(g)
    cur = 1.0
    for i, v in enumerate(g):
        cur = v if v < cur else v + (cur - v) * rel
        out[i] = cur
    # attack smoothing over the look-ahead window
    out = minimum_filter1d(out, size=la) if la > 1 else out
    y = x * out[:, None]
    return np.clip(y, -ceil, ceil)


def normalize_music(x):
    g = MUSIC_TARGET_LUFS - lufs_integrated(x)
    return limit(x * 10 ** (g / 20))


# ---------------------------------------------------------------- check images
def spectrogram_png(xs, labels, path, fmax=16000):
    from PIL import Image, ImageDraw
    rows = []
    for x, lab in zip(xs, labels):
        m = x.mean(axis=1)
        f, t, S = signal.spectrogram(m, SR, nperseg=1024, noverlap=768)
        S = 10 * np.log10(S[f <= fmax] + 1e-14)
        S = np.clip((S + 120) / 100, 0, 1)
        img = Image.fromarray((S[::-1] * 255).astype(np.uint8)).resize((1000, 200)).convert("RGB")
        canvas = Image.new("RGB", (1000, 216), (20, 20, 40))
        canvas.paste(img, (0, 16))
        ImageDraw.Draw(canvas).text((4, 2), f"{lab}  (0-{fmax // 1000} kHz, -120..-20 dB)",
                                    fill=(255, 255, 0))
        rows.append(canvas)
    out = Image.new("RGB", (1000, 216 * len(rows)))
    for i, r in enumerate(rows):
        out.paste(r, (0, 216 * i))
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src-bubbros", default="assets-src/bubbros-1.6.2")
    ap.add_argument("--src-julgen", default="assets-src/julgen/SFX")
    ap.add_argument("--out", default="public/assets/audio")
    ap.add_argument("--check", help="directory for before/after spectrogram PNGs")
    args = ap.parse_args()
    bub = (ROOT / args.src_bubbros / "bubbob").resolve()
    jul = (ROOT / args.src_julgen).resolve()
    out = (ROOT / args.out).resolve()
    check = pathlib.Path(args.check) if args.check else None
    manifest = {"sfx": {}, "music": {}}

    # ---- SFX
    for event in sorted(set(JULGEN_SFX) | set(BUBBROS_SFX)):
        j = JULGEN_SFX.get(event)
        b = BUBBROS_SFX.get(event)
        use_jul = j is not None and (j[1] in ("high", "med") or b is None)
        if use_jul:
            x = ffmpeg_decode(jul / j[0], channels=1)
            y = normalize_sfx(gate_trim(dc_block(x), thresh_db=-55.0))
            src, extra = "julgen", {"orig": j[0], "confidence": j[1]}
        else:
            y, _ = load_8bit(bub / b, music=False)
            y = normalize_sfx(gate_trim(y, thresh_db=-42.0))
            src, extra = "bubbros", {"orig": b}
        encode_ogg(y, out / "sfx" / f"{event}.ogg", 5)
        manifest["sfx"][event] = {"file": f"sfx/{event}.ogg", "volume": 1.0, "source": src,
                                  "duration": round(len(y) / SR, 3), **extra}
        if use_jul and b is not None:  # keep the Mac sound as an alternative
            ya, _ = load_8bit(bub / b, music=False)
            ya = normalize_sfx(gate_trim(ya, thresh_db=-42.0))
            encode_ogg(ya, out / "sfx" / f"{event}_mac.ogg", 5)
            manifest["sfx"][f"{event}_mac"] = {"file": f"sfx/{event}_mac.ogg", "volume": 1.0,
                                               "source": "bubbros", "orig": b,
                                               "duration": round(len(ya) / SR, 3)}
        if check and event in ("die", "hurry"):
            raw = load_8bit_raw(bub / b)
            raw = raw * (np.abs(y).max() / max(np.abs(raw).max(), 1e-9))
            spectrogram_png([raw, y], [f"{b} before (8-bit, soxr upsampled)", f"{event}.ogg after"],
                            check / f"sfx_{event}.png", fmax=11000)
        print(f"sfx  {event:12s} {src:8s} {len(y) / SR:6.3f}s")

    # ---- music
    for name, (srcpath, loop) in MUSIC.items():
        if srcpath.startswith("julgen:"):
            p = jul / srcpath.split(":", 1)[1]
            x = dc_block(ffmpeg_decode(p))
            src = "julgen"
            raw = None
        else:
            p = bub / srcpath
            raw = load_8bit_raw(p)
            x, _ = load_8bit(p, music=True, circular=(loop == "whole"))
            src = "bubbros"
        entry = {"source": src, "orig": p.name if src == "julgen" else srcpath}
        if loop is None or isinstance(loop, tuple):
            # one-shots and baked loops: drop leading silence
            mono = np.abs(x).max(axis=1)
            first = int(np.argmax(mono > 10 ** (-50 / 20)))
            cut = max(0, first - int(0.010 * SR))
            x = x[cut:]
            if raw is not None:
                raw = raw[cut:]
        if isinstance(loop, tuple):
            lag, (wa, wb) = loop
            off = cut / SR
            s, e, nc = refine_loop(x, lag, (wa - off, wb - off))
            x = bake_loop(x, s, e)
            entry.update(loop=True, loopStart=round(s / SR, 6), loopEnd=round(e / SR, 6),
                         loopMatch=round(float(nc), 3))
        elif loop == "whole":
            entry.update(loop=True, loopStart=0.0, loopEnd=None)
        else:
            entry.update(loop=False, loopStart=0.0, loopEnd=None)
            x = gate_trim(x, thresh_db=-60.0, fade=0.050)
        y = normalize_music(x)
        if loop == "whole":
            y = smooth_wrap(y)
        encode_ogg(y, out / "music" / f"{name}.ogg", 6)
        manifest["music"][name] = {"file": f"music/{name}.ogg", **entry, "volume": MUSIC_VOLUME,
                                   "duration": round(len(y) / SR, 3)}
        if check and raw is not None and name in ("main_mac", "main2", "ext1", "potion"):
            seg = slice(int(10 * SR), int(25 * SR)) if len(y) > 30 * SR else slice(0, len(y))
            rawn = raw * (np.abs(y).max() / max(np.abs(raw).max(), 1e-9))
            spectrogram_png([rawn[seg], y[seg]], [f"{srcpath} before", f"{name}.ogg after"],
                            check / f"music_{name}.png")
        print(f"music {name:10s} {src:8s} {len(y) / SR:7.2f}s loop={entry.get('loopStart')}..{entry.get('loopEnd')}"
              f"{' match=' + str(entry['loopMatch']) if 'loopMatch' in entry else ''}"
              f" LUFS={lufs_integrated(y):.1f}")

    (out / "audio.json").write_text(json.dumps(manifest, indent=2) + "\n")
    total = sum(f.stat().st_size for f in out.rglob("*.ogg"))
    print(f"total ogg size: {total / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
