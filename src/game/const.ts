// Game tuning. Movement constants are per 60 Hz frame and mostly come from
// The Bub's Brothers (which ran at 40 Hz): running them at 60 Hz gives the
// faster pace of the arcade original.

export const FPS = 60;
export const sec = (s: number) => Math.round(s * FPS);

export const CELL = 16;
export const HALF = 8;
export const HUD_H = 32; // top score bar
export const FIELD_Y = HUD_H; // playfield origin on screen

export const PLAYER = {
  walkStep: 2, // px per step, one step per frame
  jumpSpeed: 7.5,
  gravity: 0.21,
  apexSpeed: 4.0, // rising stops when speed drops under this
  fallSpeed: 2, // px per frame, constant (arcade: slow, controllable descent)
  fireCooldown: 26,
  shootThrust: 8.0,
  thrustDecay: 0.965,
  spawnShield: sec(2),
  deathFrames: 72,
  respawnDelay: sec(0.5),
  startLives: 3,
};

export const BUBBLE = {
  lifetime: sec(16), // before turning white/pink/red
  plainLifetime: sec(10),
  floatSpeed: 1,
  captureLifetime: sec(9), // monster escapes angry after this
};

export const MONSTER = {
  speed: 0.75, // logic ticks per frame (each tick moves vx px)
  angrySpeed: 1.5,
  fallSpeed: 3,
  waitFrames: 30,
};

export const TIMING = {
  hurry: sec(40), // HURRY UP
  baron: sec(52), // Baron von Blubba appears
  clearWait: sec(6), // fruit collecting time after the last monster
  fruitLife: sec(7),
  scrollSpeed: 6, // px per frame for the round transition
};

export const SCORE = {
  bubblePop: 10,
  capture: 10,
  letter: 50,
  chain: [1000, 2000, 4000, 8000, 16000, 32000, 64000],
  extraLifeFirst: 30000,
  extraLifeEvery: 100000,
  extendBonus: 0,
};

export const PLAYER_COLORS = ['#3c3', '#3bf', '#f6a', '#fa3'];
