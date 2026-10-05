// High scores and settings in localStorage (wrapped: storage may be unavailable).

export interface ScoreEntry {
  name: string;
  score: number;
  round: number;
  set: string;
}

export interface Settings {
  musicVolume: number;
  sfxVolume: number;
  crt: boolean;
  autoJump: boolean;
  levelSet: string;
}

const SCORES_KEY = 'bbdx.scores.v1';
const SETTINGS_KEY = 'bbdx.settings.v1';

const DEFAULT_SCORES: ScoreEntry[] = [
  ['BUB', 100000],
  ['BOB', 80000],
  ['MCS', 60000],
  ['ARM', 50000],
  ['DAV', 40000],
  ['TAI', 30000],
  ['ZEN', 20000],
  ['MIG', 10000],
  ['PUL', 5000],
  ['BAR', 1000],
].map(([name, score]) => ({ name: name as string, score: score as number, round: 1, set: 'original' }));

export const DEFAULT_SETTINGS: Settings = {
  musicVolume: 0.7,
  sfxVolume: 0.9,
  crt: true,
  autoJump: false,
  levelSet: 'original',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: ignore */
  }
}

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    const list = raw ? (JSON.parse(raw) as ScoreEntry[]) : null;
    return Array.isArray(list) && list.length ? list : [...DEFAULT_SCORES];
  } catch {
    return [...DEFAULT_SCORES];
  }
}

export function isHighScore(score: number): boolean {
  const s = loadScores();
  return score > 0 && (s.length < 10 || score > s[s.length - 1].score);
}

/** Insert and return the rank (0-based) or -1. */
export function addScore(e: ScoreEntry): number {
  const s = loadScores();
  s.push(e);
  s.sort((a, b) => b.score - a.score);
  const top = s.slice(0, 10);
  write(SCORES_KEY, top);
  return top.indexOf(e);
}

export function loadSettings(): Settings {
  return read(SETTINGS_KEY, DEFAULT_SETTINGS);
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}
