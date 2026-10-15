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

// The same frame has no allow-modals and no allow-popups: confirm() quietly returns false (a destructive step that asks
// first would never run), alert() and prompt() do nothing, and window.open() opens nothing. A confirmation is inline UI;
// a link goes out through the host (`store.openUrl`). `store.confirmLeave(` and the like are not these: only the bare calls
// and the same calls on `window` or `globalThis` count.
const DIALOGS = /(?<![\w$.])(?:confirm|alert|prompt)\s*\(|\b(?:window|globalThis|self|top|parent)\s*\.\s*(?:confirm|alert|prompt|open)\s*\(/;

describe('sandboxed host frame (allow-scripts only)', () => {
  it('has no confirm(), alert(), prompt() or window.open() anywhere in src/panel', () => {
    const files = sources(join(process.cwd(), 'src/panel'));
    const hits = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (DIALOGS.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  it('the dialog guard sees the calls it is for and leaves the store methods alone', () => {
    for (const bad of ['if (confirm("sure")) go();', 'alert(1)', 'const t = prompt("x")', 'window.open(url)', 'window.confirm("x")', ' confirm ("x")']) expect(DIALOGS.test(bad), bad).toBe(true);
    for (const fine of ['store.confirmLeave(go)', 'confirmFirstContact()', 'onConfirm(x)', 'host.openUrl(url)', 'this.alert(1)', 'const reopen = (x)', 'openRelated(id)']) expect(DIALOGS.test(fine), fine).toBe(false);
  });

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
