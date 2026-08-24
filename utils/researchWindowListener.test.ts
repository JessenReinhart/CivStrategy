import { describe, expect, it, vi } from 'vitest';
import { addResearchWindowListener } from './researchWindowListener';

describe('addResearchWindowListener', () => {
  it('removes the same research handler that it registered', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const target = { addEventListener, removeEventListener } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
    const handler = vi.fn() as unknown as EventListener;

    const cleanup = addResearchWindowListener(target, handler);

    expect(addEventListener).toHaveBeenCalledWith('request-start-research', handler);

    cleanup();

    expect(removeEventListener).toHaveBeenCalledWith('request-start-research', handler);
  });
});
