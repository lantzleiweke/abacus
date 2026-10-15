import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../../src/panel/ui/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Selectors of every rule that sets a scrollbar property. */
const scrollbarSelectors = () =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter(([, , body]) => /scrollbar-(width|color|gutter)\s*:/.test(body))
    .map(([, selector]) => selector.trim());

describe('panel scrollbars', () => {
  // OpenChamber appends `* {...}` and `:hover {...}` scrollbar rules after the panel's styles. A rule here with any
  // specificity beats `*` at rest and loses to `:hover`, so pointing at the panel swaps the scrollbar and the list
  // reflows. Zero specificity lets the host's rules win in both states.
  it('sets scrollbar properties only at zero specificity, so the host scrollbar never changes on hover', () => {
    const selectors = scrollbarSelectors();
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) expect(selector).toMatch(/^:where\([^)]*\)$/);
  });
});

/** The declarations of the first rule whose selector is exactly `selector`. */
const ruleOf = (selector: string) => Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).find(([, sel]) => sel!.trim() === selector)?.[2] ?? '';

describe('restore controls', () => {
  // --bd-dim is about 2.7:1 on the panel background; --bd-muted is about 5.4:1. Touch has no hover, so the resting colour is the one read.
  it('the resting Restore action and its notes are muted or stronger, never dim', () => {
    for (const selector of ['.bd-rs-btn', '.bd-rs-tag', '.bd-menu-id']) {
      const color = /(?:^|;|\s)color:\s*([^;]+)/.exec(ruleOf(selector))?.[1]?.trim();
      expect(color, selector).toMatch(/var\(--bd-(muted|fg)\)/);
    }
  });
});

describe('memory controls', () => {
  // Muted alone was borderline in dark mode at 11 px; the resting Edit, Forget and dates lean toward the text colour, never dim.
  it('the resting Edit and Forget and the change line are muted mixed toward the text colour, never dim', () => {
    for (const selector of ['.bd-mem-act', '.bd-mem-meta']) {
      const color = /(?:^|;|\s)color:\s*([^;]+)/.exec(ruleOf(selector))?.[1]?.trim();
      expect(color, selector).toMatch(/^color-mix\(in srgb, var\(--bd-muted\) \d+%, var\(--bd-fg\)\)$/);
    }
  });
});
