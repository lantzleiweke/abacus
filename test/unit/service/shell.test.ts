import { describe, expect, it } from 'vitest';
import { shellQuote } from '../../../src/service/shell';

describe('shellQuote', () => {
  it('leaves safe words alone and single-quotes everything else', () => {
    expect(shellQuote('dolt')).toBe('dolt');
    expect(shellQuote('--actor')).toBe('--actor');
    expect(shellQuote('Ann (panel)')).toBe("'Ann (panel)'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote('')).toBe("''");
    expect(shellQuote('a$b')).toBe("'a$b'");
  });
});
