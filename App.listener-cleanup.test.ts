import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('App window listener lifecycle', () => {
  it('removes the research listener with the same handler used for registration', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

    const registrations = source.match(/window\.addEventListener\('request-start-research', researchHandler\);/g) ?? [];
    const cleanups = source.match(/window\.removeEventListener\('request-start-research', researchHandler\);/g) ?? [];

    expect(registrations).toHaveLength(1);
    expect(cleanups).toHaveLength(1);
  });
});
