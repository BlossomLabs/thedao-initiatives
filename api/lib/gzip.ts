/** Gzip round trip for stored snapshots (the feeds compress four to five times). */
const collect = (stream: ReadableStream<Uint8Array>) =>
  new Response(stream).arrayBuffer().then((b) => new Uint8Array(b));

export const gzip = (bytes: Uint8Array): Promise<Uint8Array> =>
  collect(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip")));

export const gunzip = (bytes: Uint8Array): Promise<Uint8Array> =>
  collect(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip")));
