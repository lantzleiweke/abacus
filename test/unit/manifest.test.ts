import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const manifest = pkg.openchamber;

describe('manifest', () => {
  it('matches the global constraints exactly', () => {
    expect(manifest).toEqual({
      apiVersion: 1,
      engines: { openchamber: '>=2.3.2' },
      contributes: {
        panel: { id: 'beads', name: 'Abacus', icon: 'icon.svg', entry: 'panel/index.html' },
        attach: { mode: 'dialog', entry: 'panel/attach.html' },
        commands: [{ name: 'bd', description: 'Attach a bead by id, e.g. /bd k3f2' }],
        capabilities: ['sessions', 'prompt'],
        service: {
          entry: 'service/main.js',
          runtime: 'host',
          permissions: { exec: ['bd', 'dolt', 'git'] },
        },
      },
    });
  });

  it('has a semver package version', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('ships every declared entry file and its built script', () => {
    const c = manifest.contributes;
    const files = [
      c.panel.icon,
      c.panel.entry,
      c.attach.entry,
      c.service.entry,
      'panel/main.js',
      'panel/attach.js',
      'service/package.json',
    ];
    for (const file of files) expect(existsSync(resolve(root, file)), file).toBe(true);
  });

  it('declares a valid command and panel id', () => {
    const c = manifest.contributes;
    expect(c.panel.id).toMatch(/^[a-z][a-z0-9-]*$/);
    for (const cmd of c.commands) {
      expect(cmd.name).toMatch(/^[a-z][a-z0-9-]{0,23}$/);
      expect(cmd.description.length).toBeGreaterThanOrEqual(1);
      expect(cmd.description.length).toBeLessThanOrEqual(80);
    }
  });
});
