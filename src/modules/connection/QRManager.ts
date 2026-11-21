import QRCode from 'qrcode';
import jsQR from 'jsqr';

/**
 * Renders a payload as a QR image. Longer payloads are drawn larger (more
 * pixels, same module count) so the camera still sees crisp squares.
 */
export async function qrDataUrl(text: string, size?: number): Promise<string> {
  const pixels = size ?? (text.length > 900 ? 720 : 460);
  return QRCode.toDataURL(text, {
    // Level L holds the most data; the payload is carried a few centimetres, so
    // the usual smudge tolerance is not needed.
    errorCorrectionLevel: text.length > 900 ? 'L' : 'M',
    margin: 1,
    width: pixels,
    color: { dark: '#08090bff', light: '#ffffffff' },
  });
}

export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#08090b', light: '#ffffff' } });
}

export interface ScannerOptions {
  video: HTMLVideoElement;
  onResult: (text: string) => void;
  onError?: (message: string) => void;
}

/** Camera-based QR reader built on getUserMedia + jsQR. */
export class QrScanner {
  private stream: MediaStream | null = null;
  private frame = 0;
  private running = false;
  private canvas = document.createElement('canvas');
  private context: CanvasRenderingContext2D | null = null;
  private lastValue = '';
  private lastValueAt = 0;

  constructor(private options: ScannerOptions) {}

  get active(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access is unavailable. A secure context (HTTPS or localhost) is required.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    const { video } = this.options;
    video.srcObject = this.stream;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    await video.play();
    this.context = this.canvas.getContext('2d', { willReadFrequently: true });
    this.running = true;
    this.tick();
  }

  private tick = (): void => {
    if (!this.running) return;
    const { video, onResult, onError } = this.options;
    try {
      if (video.readyState >= video.HAVE_ENOUGH_DATA && this.context) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (width > 0 && height > 0) {
          this.canvas.width = width;
          this.canvas.height = height;
          this.context.drawImage(video, 0, 0, width, height);
          const image = this.context.getImageData(0, 0, width, height);
          const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
          const value = found?.data?.trim();
          if (value) {
            const now = Date.now();
            // Debounce identical consecutive reads so one QR is not added twice.
            if (value !== this.lastValue || now - this.lastValueAt > 2500) {
              this.lastValue = value;
              this.lastValueAt = now;
              onResult(value);
            }
          }
        }
      }
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'QR scanning failed.');
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  stop(): void {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.options.video.srcObject) this.options.video.srcObject = null;
  }
}
