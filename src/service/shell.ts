/** Single-quotes a command word unless it is plainly safe, so a line of a log can be pasted into a shell. */
export function shellQuote(arg: string): string {
  if (arg !== '' && /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}
