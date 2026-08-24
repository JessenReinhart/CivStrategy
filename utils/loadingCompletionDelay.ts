export interface LoadingCompletionDelay {
  schedule: () => void;
  cancel: () => void;
}

export const createLoadingCompletionDelay = (
  onComplete: () => void,
  delayMs = 500,
): LoadingCompletionDelay => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timeoutId === null) return;
    clearTimeout(timeoutId);
    timeoutId = null;
  };

  const schedule = () => {
    cancel();
    timeoutId = setTimeout(() => {
      timeoutId = null;
      onComplete();
    }, delayMs);
  };

  return { schedule, cancel };
};
