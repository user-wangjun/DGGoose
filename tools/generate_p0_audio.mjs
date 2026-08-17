import fs from 'node:fs';
import path from 'node:path';

const SAMPLE_RATE = 16000;
const AUDIO_DIR = path.resolve('assets/audio');
const TAU = Math.PI * 2;

fs.mkdirSync(AUDIO_DIR, { recursive: true });

const midi = (note) => 440 * 2 ** ((note - 69) / 12);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function envelope(t, duration, attack = 0.02, release = 0.12) {
  if (t < attack) return t / attack;
  if (t > duration - release) return Math.max(0, (duration - t) / release);
  return 1;
}

function addTone(buffer, start, duration, frequency, amplitude, shape = 'triangle', slide = 0) {
  const startIndex = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const endIndex = Math.min(buffer.length, Math.ceil((start + duration) * SAMPLE_RATE));
  for (let index = startIndex; index < endIndex; index += 1) {
    const t = (index - startIndex) / SAMPLE_RATE;
    const progress = duration ? t / duration : 0;
    const currentFrequency = frequency * (1 + slide * progress);
    const phase = TAU * currentFrequency * t;
    const wave = shape === 'square'
      ? Math.sign(Math.sin(phase))
      : shape === 'sine'
        ? Math.sin(phase)
        : 2 * Math.asin(Math.sin(phase)) / Math.PI;
    buffer[index] += wave * amplitude * envelope(t, duration);
  }
}

function addNoise(buffer, start, duration, amplitude) {
  const startIndex = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const endIndex = Math.min(buffer.length, Math.ceil((start + duration) * SAMPLE_RATE));
  let seed = Math.floor(start * 100000) + Math.floor(duration * 1000);
  for (let index = startIndex; index < endIndex; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    const t = (index - startIndex) / SAMPLE_RATE;
    buffer[index] += noise * amplitude * envelope(t, duration, 0.005, Math.min(0.08, duration * 0.6));
  }
}

function addSweep(buffer, start, duration, from, to, amplitude, shape = 'sine') {
  const startIndex = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const endIndex = Math.min(buffer.length, Math.ceil((start + duration) * SAMPLE_RATE));
  for (let index = startIndex; index < endIndex; index += 1) {
    const t = (index - startIndex) / SAMPLE_RATE;
    const progress = duration ? t / duration : 0;
    const frequency = from + (to - from) * progress;
    const phase = TAU * frequency * t;
    const wave = shape === 'triangle'
      ? 2 * Math.asin(Math.sin(phase)) / Math.PI
      : Math.sin(phase);
    buffer[index] += wave * amplitude * envelope(t, duration, 0.01, Math.min(0.16, duration * 0.35));
  }
}

function writeWav(filename, samples) {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0.92 ? 0.92 / peak : 1;
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    pcm.writeInt16LE(Math.round(clamp(sample * gain, -1, 1) * 32767), index * 2);
  });

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(path.join(AUDIO_DIR, filename), Buffer.concat([header, pcm]));
}

const bgmTracks = {
  menu: { bpm: 94, roots: [50, 53, 57, 55], melody: [74, 76, 77, 81, 79, 77, 76, 74], color: 'sine' },
  factory: { bpm: 118, roots: [45, 45, 48, 43], melody: [69, 72, 74, 72, 69, 67, 69, 72], color: 'square' },
  basketball: { bpm: 128, roots: [52, 55, 57, 59], melody: [76, 79, 81, 84, 81, 79, 76, 74], color: 'triangle' },
  lychee: { bpm: 86, roots: [57, 60, 62, 65], melody: [81, 84, 86, 88, 86, 84, 81, 79], color: 'sine' },
  goose: { bpm: 108, roots: [48, 51, 55, 53], melody: [72, 75, 77, 75, 72, 70, 72, 75], color: 'triangle' },
  industrial: { bpm: 122, roots: [43, 46, 48, 41], melody: [67, 70, 72, 75, 72, 70, 67, 65], color: 'square' },
  campus: { bpm: 78, roots: [55, 59, 62, 60], melody: [79, 81, 83, 86, 83, 81, 79, 76], color: 'sine' },
  songshan: { bpm: 64, roots: [50, 54, 57, 55], melody: [74, 77, 81, 79, 77, 74, 72, 69], color: 'sine' },
};

function renderBgm(track) {
  const seconds = 8;
  const buffer = new Float32Array(Math.floor(seconds * SAMPLE_RATE));
  const beat = 60 / track.bpm;
  const bar = beat * 4;

  for (let barIndex = 0; barIndex < 4; barIndex += 1) {
    const root = track.roots[barIndex];
    addTone(buffer, barIndex * bar, bar * 0.96, midi(root), 0.16, 'sine');
    addTone(buffer, barIndex * bar, bar * 0.96, midi(root + 7), 0.06, 'sine');
    for (let beatIndex = 0; beatIndex < 4; beatIndex += 1) {
      const at = barIndex * bar + beatIndex * beat;
      addTone(buffer, at, beat * 0.42, midi(root + (beatIndex % 2 ? 12 : 7)), 0.09, 'triangle');
      if (track.bpm >= 100 || beatIndex % 2 === 0) addNoise(buffer, at, 0.035, 0.035);
    }
  }

  track.melody.forEach((note, index) => {
    const at = index * beat;
    addTone(buffer, at, beat * 0.72, midi(note), 0.14, track.color);
    if (index % 2 === 0) addTone(buffer, at + beat * 0.5, beat * 0.22, midi(note + 12), 0.035, 'sine');
  });

  return buffer;
}

const sfxDurations = {
  click: 0.08,
  typewriter: 0.045,
  goal: 0.72,
  miss: 0.32,
  caught: 0.78,
  steal: 0.46,
  collect: 0.7,
  gate: 0.9,
  error: 0.38,
  transition: 0.62,
  ending: 1.05,
  jump: 0.5,
};

function renderSfx(name) {
  const buffer = new Float32Array(Math.floor(sfxDurations[name] * SAMPLE_RATE));
  switch (name) {
    case 'click':
      addTone(buffer, 0, 0.07, 880, 0.28, 'sine');
      addTone(buffer, 0, 0.035, 1760, 0.06, 'sine');
      break;
    case 'typewriter':
      addNoise(buffer, 0, 0.035, 0.18);
      addTone(buffer, 0, 0.03, 1450, 0.08, 'square');
      break;
    case 'goal':
      addSweep(buffer, 0, 0.42, 520, 1040, 0.24, 'triangle');
      addTone(buffer, 0.42, 0.28, midi(84), 0.2, 'sine');
      addTone(buffer, 0.52, 0.2, midi(88), 0.13, 'sine');
      break;
    case 'miss':
      addSweep(buffer, 0, 0.25, 340, 120, 0.25, 'triangle');
      addNoise(buffer, 0.08, 0.2, 0.05);
      break;
    case 'caught':
      addTone(buffer, 0, 0.18, 220, 0.26, 'square');
      addTone(buffer, 0.27, 0.18, 180, 0.26, 'square');
      addTone(buffer, 0.54, 0.18, 220, 0.23, 'square');
      break;
    case 'steal':
      addSweep(buffer, 0, 0.28, 280, 620, 0.2, 'sine');
      addTone(buffer, 0.28, 0.17, midi(76), 0.16, 'triangle');
      break;
    case 'collect':
      [76, 81, 84, 88].forEach((note, index) => addTone(buffer, index * 0.13, 0.25, midi(note), 0.18, 'sine'));
      break;
    case 'gate':
      addTone(buffer, 0, 0.8, 78, 0.18, 'sine');
      addSweep(buffer, 0.08, 0.7, 130, 420, 0.16, 'triangle');
      break;
    case 'error':
      addTone(buffer, 0, 0.16, 180, 0.24, 'square');
      addTone(buffer, 0.2, 0.16, 130, 0.24, 'square');
      break;
    case 'transition':
      addSweep(buffer, 0, 0.58, 180, 720, 0.14, 'sine');
      break;
    case 'ending':
      [69, 76, 81, 85].forEach((note, index) => addTone(buffer, index * 0.14, 0.7, midi(note), 0.16, 'sine'));
      break;
    case 'jump':
      addSweep(buffer, 0, 0.42, 180, 820, 0.18, 'triangle');
      addNoise(buffer, 0.1, 0.24, 0.04);
      break;
    default:
      break;
  }
  return buffer;
}

for (const [name, track] of Object.entries(bgmTracks)) {
  writeWav(`bgm_${name}.wav`, renderBgm(track));
}

for (const name of Object.keys(sfxDurations)) {
  writeWav(`sfx_${name}.wav`, renderSfx(name));
}

console.log(`Generated ${Object.keys(bgmTracks).length} BGM + ${Object.keys(sfxDurations).length} SFX in ${AUDIO_DIR}`);
