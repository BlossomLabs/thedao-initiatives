import {
  ConfigurationFiles,
  initializeImageMagick,
  MagickFormat,
  MagickImage,
  MagickReadSettings,
  ResourceLimits,
} from "npm:@imagemagick/magick-wasm@0.0.43";
import { imageExt } from "./validate.ts";

const initialized = (async () => {
  const files = ConfigurationFiles.default;
  files.policy.data = `<policymap>
  <policy domain="delegate" rights="none" pattern="*"/>
  <policy domain="coder" rights="none" pattern="*"/>
  <policy domain="coder" rights="read|write" pattern="{PNG,JPEG,WEBP}"/>
</policymap>`;
  await initializeImageMagick(
    await Deno.readFile(
      new URL(import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.43/magick.wasm")),
    ),
    files,
  );
  ResourceLimits.width = 4096n;
  ResourceLimits.height = 4096n;
  ResourceLimits.area = 4_000_000n;
  ResourceLimits.memory = 64n * 1024n * 1024n;
  ResourceLimits.disk = 0n;
  ResourceLimits.maxMemoryRequest = 64n * 1024n * 1024n;
  ResourceLimits.maxProfileSize = 1024n * 1024n;
  // Ping, decode and encoder working images also consume this limit.
  ResourceLimits.listLength = 4n;
})();

const worker = self as unknown as {
  onmessage: (event: MessageEvent<Uint8Array>) => void;
  postMessage: (data: unknown) => void;
};
// The decode deadline on the main thread starts only once this has been received.
initialized.then(
  () => worker.postMessage({ ready: true }),
  () => worker.postMessage({ ready: false }),
);
worker.onmessage = async ({ data }) => {
  try {
    await initialized;
  } catch {
    worker.postMessage(null);
    return;
  }
  const ext = imageExt(data);
  if (!ext) {
    worker.postMessage(null);
    return;
  }
  const image = MagickImage.create();
  try {
    const settings = new MagickReadSettings({
      frameIndex: 0,
      frameCount: 1,
      format: ext === "png"
        ? MagickFormat.Png
        : ext === "jpg"
        ? MagickFormat.Jpeg
        : MagickFormat.WebP,
    });
    let warning = false;
    image.onWarning = () => {
      warning = true;
    };
    image.ping(data, settings);
    if (warning || image.width < 1 || image.height < 1 || image.width * image.height > 4_000_000) {
      worker.postMessage(null);
      return;
    }
    // Fully decode before writing. Re-encoding discards appended payloads and metadata.
    image.read(data, settings);
    if (warning) {
      worker.postMessage(null);
      return;
    }
    image.autoOrient();
    image.strip();
    image.quality = 85;
    const bytes = image.write(settings.format!, (bytes) => bytes.slice());
    worker.postMessage({ bytes, ext });
  } catch {
    worker.postMessage(null);
  } finally {
    image.dispose();
  }
};
