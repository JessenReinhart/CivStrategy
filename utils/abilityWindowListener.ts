export function addAbilityWindowListener(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  handler: EventListener,
): () => void {
  target.addEventListener('activate-ability', handler);
  return () => target.removeEventListener('activate-ability', handler);
}
