export interface Pingable {
  ping: () => Promise<void>;
}

export function createHealthHandler(
  getDb: () => Pingable,
  options: { timeoutMs?: number } = {},
): () => Promise<Response> {
  return () => {
    void getDb;
    void options;
    throw new Error('not implemented');
  };
}
