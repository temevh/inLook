// AudioWorklet: turns the mic into 16 kHz mono s16le frames of 100 ms (1600 samples).
// Plain JS because the worklet scope has no DOM types; copy-static.mjs copies it
// next to widget.js. Resamples with linear interpolation when the context does not
// run at 16 kHz (Chromium normally honours the requested rate, so this is a fallback).
const RATE = 16000;
const FRAME_SAMPLES = 1600;

class PcmFrames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / RATE; // input samples per output sample
    this.pos = 0;                  // next output position, in input samples, relative to this block
    this.last = 0;                 // last input sample of the previous block (for interpolation)
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.filled = 0;
  }

  push(x) {
    this.frame[this.filled++] = Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
    if (this.filled === FRAME_SAMPLES) {
      this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
      this.frame = new Int16Array(FRAME_SAMPLES);
      this.filled = 0;
    }
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const n = ch.length;
    if (this.step === 1) {
      for (let i = 0; i < n; i++) this.push(ch[i]);
      return true;
    }
    while (Math.floor(this.pos) + 1 < n) {
      const i = Math.floor(this.pos), f = this.pos - i;
      const a = i < 0 ? this.last : ch[i];
      this.push(a + (ch[i + 1] - a) * f);
      this.pos += this.step;
    }
    this.pos -= n;
    this.last = ch[n - 1];
    return true;
  }
}

registerProcessor("pcm-frames", PcmFrames);
