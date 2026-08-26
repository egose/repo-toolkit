export function byteLengthUtf8(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export function truncateUtf8ToBytes(text: string, maxBytes: number): string {
  if (byteLengthUtf8(text) <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  for (const ch of text) {
    const bl = byteLengthUtf8(ch);
    if (bytes + bl > maxBytes) break;
    bytes += bl;
    end += ch.length;
  }
  return text.slice(0, end);
}

export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1B\[[0-9;]*m/gu, '');
}

export function truncateToBytes(text: string, maxBytes: number): string {
  return truncateUtf8ToBytes(text, maxBytes);
}
