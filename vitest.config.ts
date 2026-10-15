import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The preview's fake service loads fixture `.jsonl` files as text (esbuild's `--loader:.jsonl=text`); tests do the same.
  plugins: [
    {
      name: 'jsonl-as-text',
      enforce: 'pre',
      load(id) {
        const path = id.split('?')[0]!;
        return path.endsWith('.jsonl') ? `export default ${JSON.stringify(readFileSync(path, 'utf8'))};` : null;
      },
    },
  ],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
  },
});
