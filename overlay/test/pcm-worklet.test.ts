import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/** Load the worklet source with a stubbed AudioWorkletGlobalScope and return a processor. */
function load(sampleRate: number) {
  const frames: Int16Array[] = [];
  let Cls: any;
  class AudioWorkletProcessor { port = { postMessage: (b: ArrayBuffer) => frames.push(new Int16Array(b)) }; }
  runInNewContext(readFileSync("src/renderer/widget/pcm-worklet.js", "utf8"), {
    AudioWorkletProcessor, sampleRate, Math, Int16Array, registerProcessor: (_: string, c: unknown) => (Cls = c),
  });
  return { proc: new Cls(), frames };
}

/** Feed `seconds` of a 1 kHz sine in 128-sample blocks, like the audio thread does. */
function feed(sampleRate: number, seconds: number) {
  const { proc, frames } = load(sampleRate);
  const total = Math.round(sampleRate * seconds);
  for (let i = 0; i < total; i += 128) {
    const block = new Float32Array(128).map((_, k) => 0.5 * Math.sin((2 * Math.PI * 1000 * (i + k)) / sampleRate));
    proc.process([[block]]);
  }
  return frames;
}

describe("pcm-worklet", () => {
  for (const rate of [16000, 48000, 44100]) {
    it(`emits 100 ms s16 frames at 16 kHz from a ${rate} Hz context`, () => {
      const frames = feed(rate, 1);
      expect(frames.length).toBeGreaterThanOrEqual(9);
      expect(frames.length).toBeLessThanOrEqual(10);
      for (const f of frames) expect(f.length).toBe(1600);
      // 1 kHz at 16 kHz = 16 samples per period; check zero-crossing count (2 per period) in the first frame.
      const f = frames[2]!;
      let crossings = 0;
      for (let i = 1; i < f.length; i++) if (f[i - 1]! < 0 !== f[i]! < 0) crossings++;
      expect(crossings).toBeGreaterThanOrEqual(198);
      expect(crossings).toBeLessThanOrEqual(202);
      expect(Math.max(...f)).toBeGreaterThan(15000);
    });
  }
});
