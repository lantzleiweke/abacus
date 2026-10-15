/** esbuild loads `.css` as text (`--loader:.css=text`); the panel injects it into a <style>. */
declare module '*.css' {
  const text: string;
  export default text;
}
