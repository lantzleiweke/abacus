import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// OpenChamber loads the panel in <iframe sandbox="allow-scripts">: no allow-forms. Chrome then blocks every form
// submission and never fires the submit event, so a <form> with a submit button silently does nothing in the host while
// jsdom, which has no sandbox, still passes. Nothing under src/panel may depend on form submission: buttons are
// type="button" with onClick, and Enter is a keydown handler.
const FORBIDDEN = ['<form', 'onSubmit', 'type="submit"', ".submit(", 'requestSubmit'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
  });
}

describe('sandboxed host frame (allow-scripts only)', () => {
  it('has no form submission anywhere in src/panel', () => {
    const files = sources(join(process.cwd(), 'src/panel'));
    expect(files.length).toBeGreaterThan(0);
    const hits = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return FORBIDDEN.filter((needle) => text.includes(needle)).map((needle) => `${file}: ${needle}`);
    });
    expect(hits).toEqual([]);
  });
});
