// Mic capture: getUserMedia → AudioContext → AudioWorklet (pcm-worklet.js), which
// emits 16 kHz mono s16le frames of ~100 ms. Frames go to main over IPC, which
// streams them to the backend (WS /audio/stream). Capture needs renderer APIs,
// so it runs here.

export class MicCapture {
  private stream?: MediaStream;
  private ctx?: AudioContext;

  constructor(private onFrame: (pcm: ArrayBuffer) => void) {}

  get running() { return !!this.stream; }

  async start() {
    if (this.stream) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    try {
      const ctx = new AudioContext({ sampleRate: 16000 });
      this.ctx = ctx;
      await ctx.audioWorklet.addModule(new URL("pcm-worklet.js", import.meta.url).href);
      const node = new AudioWorkletNode(ctx, "pcm-frames", { numberOfInputs: 1, numberOfOutputs: 0 });
      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => this.onFrame(e.data);
      ctx.createMediaStreamSource(stream).connect(node);
      await ctx.resume();
      this.stream = stream;
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      void this.ctx?.close();
      this.ctx = undefined;
      throw err;
    }
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = this.ctx = undefined;
  }
}
