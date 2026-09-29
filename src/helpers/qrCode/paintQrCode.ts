import pause from '@helpers/schedulers/pause';

/**
 * Builds a Telegram-styled QR canvas for `data` using the supplied palette.
 * Shared between the auth-flow `SignQRCard` and the in-app "My QR code" popup.
 *
 * The host element receives the canvas as its last child; existing children
 * (e.g. a preloader) are left in place so the caller can decide when to fade
 * them out, mirroring the legacy `SignQRCard` behaviour.
 *
 * Returns a teardown that strips every QR canvas this call appended, so the
 * caller can reset the host before repainting (e.g. on theme change).
 */
export type PaintQrOptions = {
  data: string;
  size: number;
  host: HTMLElement;
  /** Backdrop color behind the dots (usually the QR card surface color). */
  background: string;
  /** Dot color — the "ink" of the QR code. */
  foreground: string;
  /** @deprecated Use image instead. Retained for the profile QR caller. */
  logoColor?: string;
  /** Optional center mark. Omit it for unbranded QR codes. */
  image?: string;
  /**
   * Device-pixel multiplier for the rendered QR bitmap. Defaults to the screen
   * DPR. The My QR popup passes max(screenDPR, 3) so the QR stays crisp in its
   * 3×-scale (1170×2532) export PNG even on 1×/2× displays.
   */
  pixelRatio?: number;
  /**
   * Class added to the QR canvas the instant it's appended — before the draw
   * race is awaited — so the canvas is already correctly sized while qr-code-
   * styling finishes loading the logo (the auth `SignQRCard` reveal relies on
   * the canvas filling its container during that window).
   */
  canvasClass?: string;
  /** Already-loaded `qr-code-styling` constructor; loaded lazily by the caller. */
  QRCodeStylingCtor: any;
};

export async function paintQrCode(options: PaintQrOptions) {
  const {data, size, host, background, foreground, image, pixelRatio = window.devicePixelRatio, QRCodeStylingCtor} = options;

  const mark = image || (options.logoColor ? await getLegacyTelegramMark(options.logoColor) : undefined);

  const qrCode = new QRCodeStylingCtor({
    width: size * pixelRatio,
    height: size * pixelRatio,
    data,
    image: mark,
    dotsOptions: {color: foreground, type: 'rounded'},
    cornersSquareOptions: {type: 'extra-rounded', color: foreground},
    imageOptions: {imageSize: .18, margin: 0},
    backgroundOptions: {color: background},
    qrOptions: {errorCorrectionLevel: image ? 'H' : 'M'}
  });

  qrCode.append(host);
  const canvas = host.lastChild as HTMLCanvasElement;
  if(options.canvasClass) canvas.classList.add(options.canvasClass);

  // qr-code-styling races the image-load against a 1s upper bound — matches the
  // legacy behaviour so we don't leave the host stuck behind a never-loading logo.
  let drawingPromise: Promise<void>;
  const internalDrawingPromise = qrCode._drawingPromise || qrCode._canvasDrawingPromise;
  if(internalDrawingPromise) {
    drawingPromise = internalDrawingPromise;
  } else {
    const image = qrCode._canvas?._image;
    drawingPromise = Promise.race([
      pause(1000),
      new Promise<void>((resolve) => {
        if(!image || image.complete) {
          window.requestAnimationFrame(() => resolve());
          return;
        }

        image.addEventListener('load', () => {
          window.requestAnimationFrame(() => resolve());
        }, {once: true});
      })
    ]);
  }
  await drawingPromise;

  return {canvas, qrCode};
}

const logoUrlCache = new Map<string, Promise<string>>();
function getLegacyTelegramMark(color: string) {
  let url = logoUrlCache.get(color);
  if(!url) {
    url = fetch('assets/img/logo_padded.svg')
    .then((res) => res.text())
    .then((text) => `data:image/svg+xml,${encodeURIComponent(text.replace(/(fill:).+?(;)/, `$1${color}$2`))}`);
    logoUrlCache.set(color, url);
  }
  return url;
}

/**
 * Builds the public `t.me/<username>` link encoded in a user's QR code (the
 * "My QR code" popup). Kept beside `paintQrCode` so the QR callers share one
 * place for the link shape.
 */
export function buildTelegramUserQrUrl(username: string) {
  return `https://t.me/${username}`;
}
