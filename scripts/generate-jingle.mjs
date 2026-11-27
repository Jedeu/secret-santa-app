// Writes public/sounds/jingle.wav: "Jingle bells, jingle bells" as soft synthesized bells
// (mono, 16-bit, 22.05 kHz, about 1.7 s). Run with `node scripts/generate-jingle.mjs`.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const E5 = 659.25;
const BEAT = 0.2;
// [frequency, start beat, length in beats]: E E E(long), E E E(long).
const NOTES = [
    [E5, 0, 1], [E5, 1, 1], [E5, 2, 2],
    [E5, 4, 1], [E5, 5, 1], [E5, 6, 2.5],
];
const LENGTH_S = (6 + 2.5) * BEAT + 0.3;
const samples = new Float32Array(Math.ceil(LENGTH_S * RATE));

for (const [freq, start, beats] of NOTES) {
    const from = Math.floor(start * BEAT * RATE);
    const ring = (beats * BEAT + 0.25) * RATE;
    for (let i = 0; i < ring && from + i < samples.length; i += 1) {
        const t = i / RATE;
        const attack = Math.min(1, i / (0.004 * RATE));
        const decay = Math.exp(-t * 5.5);
        // A bell: the fundamental plus two quieter, inharmonic partials.
        const tone = Math.sin(2 * Math.PI * freq * t)
            + 0.35 * Math.sin(2 * Math.PI * freq * 2.76 * t) * Math.exp(-t * 9)
            + 0.18 * Math.sin(2 * Math.PI * freq * 5.4 * t) * Math.exp(-t * 14);
        samples[from + i] += 0.28 * attack * decay * tone;
    }
}

const data = Buffer.alloc(samples.length * 2);
samples.forEach((value, i) => {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), i * 2);
});
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

const out = fileURLToPath(new URL('../public/sounds/jingle.wav', import.meta.url));
writeFileSync(out, Buffer.concat([header, data]));
console.log(`wrote ${out} (${header.length + data.length} bytes)`);
