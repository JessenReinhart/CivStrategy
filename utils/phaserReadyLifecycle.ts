interface ReadyEventEmitter {
  once(event: 'ready', listener: () => void): void;
  off(event: 'ready', listener: () => void): void;
}

export function attachPhaserReadyHandler(
  emitter: ReadyEventEmitter,
  onReady: () => void,
): () => void {
  let active = true;

  const handler = () => {
    if (!active) return;
    onReady();
  };

  emitter.once('ready', handler);

  return () => {
    active = false;
    emitter.off('ready', handler);
  };
}
