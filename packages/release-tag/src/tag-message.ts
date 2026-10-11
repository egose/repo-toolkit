const TAG_SIGNATURE_START = /^-----BEGIN (?:PGP SIGNATURE|PGP MESSAGE|SSH SIGNATURE|SIGNED MESSAGE)-----\r?$/m;

export function stripTagSignature(tagMessage: string): string {
  const signatureStart = tagMessage.search(TAG_SIGNATURE_START);
  if (signatureStart === -1) {
    return tagMessage;
  }
  return tagMessage.slice(0, signatureStart).replace(/[\r\n]+$/, '');
}
