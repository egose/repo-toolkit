export function commitLog(...messages: ReadonlyArray<string>): string {
  return messages.map((message, index) => `${(index + 1).toString(16).padStart(40, '0')}\0${message}\0`).join('');
}
