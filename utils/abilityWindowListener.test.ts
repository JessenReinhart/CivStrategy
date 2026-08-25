import { describe, expect, it, vi } from 'vitest';
import { addAbilityWindowListener } from './abilityWindowListener';

describe('addAbilityWindowListener', () => {
  it('removes the same ability handler that it registered', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const target = { addEventListener, removeEventListener } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
    const handler = vi.fn() as unknown as EventListener;

    const cleanup = addAbilityWindowListener(target, handler);

    expect(addEventListener).toHaveBeenCalledWith('activate-ability', handler);

    cleanup();

    expect(removeEventListener).toHaveBeenCalledWith('activate-ability', handler);
  });
});
