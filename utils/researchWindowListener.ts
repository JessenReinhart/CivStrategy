export function addResearchWindowListener(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  handler: EventListener,
): () => void {
  target.addEventListener('request-start-research', handler);
  return () => target.removeEventListener('request-start-research', handler);
}
