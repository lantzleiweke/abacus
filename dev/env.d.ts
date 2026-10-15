/** The preview bundle loads fixture `.jsonl` files as text (`--loader:.jsonl=text`). */
declare module '*.jsonl' {
  const text: string;
  export default text;
}
