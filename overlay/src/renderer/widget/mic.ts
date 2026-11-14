// Mic capture: ~10 s Opus chunks with ~1 s overlap so sentences are not cut.
// getUserMedia/MediaRecorder are renderer APIs, so capture runs here (widget
// renderer) and chunks go to main over IPC, which POSTs them to /audio.
// Each chunk is its own MediaRecorder session, so every chunk is a standalone
// webm file with a header. A new recorder starts every CHUNK_MS - OVERLAP_MS.
import type { AudioChunk } from "../../shared/contract";

const CHUNK_MS = 10_000, OVERLAP_MS = 1_000;
const MIME = "audio/webm;codecs=opus";

export class MicCapture {
  private stream?: MediaStream;
  private timer?: number;
  private seqNo = 0;
  private live = new Set<MediaRecorder>();

  constructor(private onChunk: (c: AudioChunk) => void) {}

  get running() { return !!this.stream; }

  async start() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.startRecorder();
    this.timer = window.setInterval(() => this.startRecorder(), CHUNK_MS - OVERLAP_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.live.forEach((r) => r.state !== "inactive" && r.stop());
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
  }

  private startRecorder() {
    if (!this.stream) return;
    const rec = new MediaRecorder(this.stream, { mimeType: MIME });
    const parts: Blob[] = [];
    const startedAt = new Date().toISOString();
    const seqNo = this.seqNo++;
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    rec.onstop = async () => {
      this.live.delete(rec);
      if (!parts.length) return;
      const data = await new Blob(parts, { type: MIME }).arrayBuffer();
      this.onChunk({ data, mime: MIME, startedAt, seqNo });
    };
    rec.start();
    this.live.add(rec);
    setTimeout(() => rec.state !== "inactive" && rec.stop(), CHUNK_MS);
  }
}
