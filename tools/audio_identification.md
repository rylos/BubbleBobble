# Julgen SFX identification

Source: `assets-src/julgen/SFX/` — 44.1 kHz 16-bit stereo files whose two channels are
identical (mono content), each padded with ~17 ms of leading and ~1 s of trailing silence.
The numbers are **sorted by file length** (file 9 is missing), so they carry no meaning.
Nobody has listened to these files: the identification is based on duration, spectrograms
and pitch tracks, on what the arcade sound set contains, and on cross-correlating envelopes
and spectra against the named Bub's Brothers sounds. Only the high/med ones replace a
Bub&Bros sound in `build_audio.py`. Low-confidence ones are exported under the
"event" name shown here so they can be auditioned and renamed.

| File | Real length | Description (measured) | Identification | Conf. | Exported as |
|---|---|---|---|---|---|
| Jump.wav | 0.50 s | rising stepped tone 790→1160 Hz | jump (same contour and length as bubbros `jump.wav`, spectral corr 0.75, contour corr 0.79) | high | `jump` |
| (1) | 0.16 s | flat broadband noise burst | bubble pop (empty bubble) | med | `pop` |
| (2) | 0.22 s | fast rising arpeggio 850→1500 Hz | bubble blow/shot (the old C++ game used it for the shot) | med | `shoot` |
| (3) | 0.21 s | tonal click + noise burst | trapped monster's bubble burst / monster killed | low | `kill` |
| (4) | 0.23 s | two quick rising sweeps 860→2100 Hz | monster captured in a bubble (resembles bubbros `extra`) | low | `capture` |
| (5) | 0.30 s | bright 1.3 kHz "ding", decaying harmonics | fruit/item pickup | med | `fruit` |
| (6) | 0.30 s | 3 rising stepped chirps 830→1470 Hz | EXTEND letter pickup | low | `letter` |
| (7) | 0.36 s | steady 773 Hz square tone | coin/credit | low | `coin` |
| (8) | 0.49 s | very high (3.6 kHz) pulsed tone | sparkle (alt. letter/coin) | low | `sparkle` |
| (10) | 0.54 s | 260→518→1025 Hz, then 518 Hz held | item appears / bonus drops | low | `appear` |
| (11) | 0.71 s | 12 pulses rising 250→2100 Hz | alarm (HURRY / Baron warning?) | low | `alarm` |
| (12) | 0.71 s | 882→773 Hz held tone, same timbre as (7) | bell (alt. coin, longer) | low | `bell` |
| (13) | 0.93 s | slow modulated rise 370→920 Hz | monster killed, spinning away | low | `spin` |
| (14) | 0.93 s | 7 pulses then a rising sweep | multi-kill chain | low | `chain` |
| (15) | 0.96 s | low noise rumble (centroid 400 Hz) | fire (fire bubble / flame on floor) | low | `fire` |
| (16) | 1.29 s | fast rising arpeggio 390→2320 Hz | special item / power-up | low | `special` |
| (17) | 1.32 s | long modulated rise 240→2000 Hz | long spin (alt. skull/Baron rise) | low | `spin_long` |
| (18) | 1.33 s | low noise rumble, longer than (15) | lightning/thunder (alt. water rush) | low | `lightning` |
| (19) | 1.53 s | 1.38 kHz tone + bubbling ~13 Hz low warble | water flow | low | `water` |
| (20) | 1.60 s | C6-E6-C6-G6, then E6 re-triggered | fanfare (alt. extra life) | low | `fanfare` |
| (21) | 3.57 s | melodic run down then up, held note | jingle (alt. death jingle / bonus; matches bubbros `hell` contour weakly, corr 0.61) | low | `jingle` |

`The Quest Begins.ogg` (180 s, stereo): an 8 s intro, then the theme twice (period
89.463 s, as the onset/spectral self-similarity shows), and a fade-out from about 172 s.
Exported as `music/main.ogg` cut at loopEnd, with a baked crossfade.

Bub&Bros sounds without a confident Julgen equivalent (kept from Bub&Bros): `die`,
`hurry` (voice), `hell`, `letsgo` (voice), `yippee` (voice), `extra`, `extralife`, `shh`,
and all the minigame `extN_*` sounds. For `jump`, `pop` and `fruit`, the Bub&Bros version
is also exported as `<event>_mac`.
