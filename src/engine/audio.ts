// WebAudio sound effects and looping music driven by public/assets/audio/audio.json.

interface SfxDef {
  file: string;
  volume?: number;
}
interface MusicDef {
  file: string;
  loopStart?: number;
  loopEnd?: number | null;
  volume?: number;
}
interface Manifest {
  sfx: Record<string, SfxDef>;
  music: Record<string, MusicDef>;
}

const BASE = 'assets/audio/';

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private manifest: Manifest = { sfx: {}, music: {} };
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private music: { name: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantedMusic: { name: string; loop: boolean; rate: number } | null = null;
  private lastPlayed = new Map<string, number>();
  musicVolume = 0.7;
  sfxVolume = 0.9;
  rate = 1;

  async init(): Promise<void> {
    try {
      this.manifest = await (await fetch(BASE + 'audio.json')).json();
    } catch {
      console.warn('audio manifest missing');
    }
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);
    // preload every effect, music on demand
    for (const name of Object.keys(this.manifest.sfx)) void this.buffer(this.manifest.sfx[name].file);
    if (this.wantedMusic) {
      const w = this.wantedMusic;
      this.playMusic(w.name, w.loop, w.rate);
    }
  }

  get unlocked(): boolean {
    return !!this.ctx;
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    if (this.ctx) {
      this.musicBus.gain.value = music;
      this.sfxBus.gain.value = sfx;
    }
  }

  private buffer(file: string): Promise<AudioBuffer | null> {
    const cached = this.loading.get(file);
    if (cached) return cached;
    const p = (async () => {
      try {
        const data = await (await fetch(BASE + file)).arrayBuffer();
        const buf = await this.ctx!.decodeAudioData(data);
        this.buffers.set(file, buf);
        return buf;
      } catch (e) {
        console.warn('audio load failed', file, e);
        return null;
      }
    })();
    this.loading.set(file, p);
    return p;
  }

  preloadMusic(names: string[]): void {
    if (!this.ctx) return;
    for (const n of names) {
      const d = this.manifest.music[n];
      if (d) void this.buffer(d.file);
    }
  }

  /** Play a sound effect; pan in [-1, 1]. Same sound is not retriggered within 30 ms. */
  sfx(name: string, pan = 0, opts: { volume?: number; rate?: number } = {}): void {
    if (!this.ctx) return;
    const def = this.manifest.sfx[name];
    if (!def) return;
    const buf = this.buffers.get(def.file);
    if (!buf) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < 0.03) return;
    this.lastPlayed.set(name, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (opts.rate ?? 1) * this.rate;
    const gain = this.ctx.createGain();
    gain.gain.value = (def.volume ?? 1) * (opts.volume ?? 1);
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan)) * 0.6;
    src.connect(gain).connect(panner).connect(this.sfxBus);
    src.start();
  }

  hasMusic(name: string): boolean {
    return name in this.manifest.music;
  }

  get currentMusic(): string | null {
    return this.music?.name ?? this.wantedMusic?.name ?? null;
  }

  playMusic(name: string, loop = true, rate = 1): void {
    this.wantedMusic = { name, loop, rate };
    if (!this.ctx) return;
    if (this.music?.name === name) {
      this.music.src.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.05);
      return;
    }
    this.stopMusic(0.15);
    this.wantedMusic = { name, loop, rate };
    const def = this.manifest.music[name];
    if (!def) return;
    void this.buffer(def.file).then((buf) => {
      if (!buf || !this.ctx || this.wantedMusic?.name !== name || this.music?.name === name) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = loop;
      if (loop) {
        src.loopStart = def.loopStart ?? 0;
        src.loopEnd = def.loopEnd ?? buf.duration;
      }
      src.playbackRate.value = rate;
      const gain = this.ctx.createGain();
      gain.gain.value = def.volume ?? 1;
      src.connect(gain).connect(this.musicBus);
      src.start();
      src.onended = () => {
        if (this.music?.src === src) this.music = null;
      };
      this.music = { name, src, gain };
    });
  }

  setMusicRate(rate: number): void {
    if (this.wantedMusic) this.wantedMusic.rate = rate;
    if (this.ctx && this.music) this.music.src.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.1);
  }

  stopMusic(fade = 0.3): void {
    this.wantedMusic = null;
    if (!this.ctx || !this.music) return;
    const { src, gain } = this.music;
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + fade);
    src.stop(t + fade + 0.05);
    this.music = null;
  }
}
