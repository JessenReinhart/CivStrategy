import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLoadingCompletionDelay } from './loadingCompletionDelay';

describe('createLoadingCompletionDelay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels a pending completion so stale sessions cannot finish loading', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const delay = createLoadingCompletionDelay(onComplete, 500);

    delay.schedule();
    delay.cancel();
    vi.advanceTimersByTime(500);

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('keeps only the latest scheduled completion', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const delay = createLoadingCompletionDelay(onComplete, 500);

    delay.schedule();
    vi.advanceTimersByTime(250);
    delay.schedule();
    vi.advanceTimersByTime(250);

    expect(onComplete).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
