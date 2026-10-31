export type AudioFormat = 'wav' | 'mp3' | 'ogg' | 'm4a' | 'webm';

/** Audio container by magic bytes (the client-sent mime type is never trusted). */
export function sniffAudio(b: Buffer): AudioFormat | null {
  if (b.length < 12) {
    return null;
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') {
    return 'wav';
  }
  if (b.toString('ascii', 0, 4) === 'OggS') {
    return 'ogg';
  }
  if (b.toString('ascii', 4, 8) === 'ftyp') {
    return 'm4a';
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return 'webm';
  }
  if (b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) {
    return 'mp3';
  }
  return null;
}
