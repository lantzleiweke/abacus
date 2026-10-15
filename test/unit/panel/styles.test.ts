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
