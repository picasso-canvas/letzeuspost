// The health check (§13 The app's API, §14 Deploys: the deploy checks it and rolls back when it fails). It answers
// whether the app can reach its database, and nothing else: no error text, no setting, no person.

export interface Pingable {
  ping: () => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 3000;

function answer(status: 'ok' | 'unavailable', code: number): Response {
  // Never cached: a deploy's check must see the database as it is now.
  return Response.json({ status }, { status: code, headers: { 'cache-control': 'no-store' } });
}

export function createHealthHandler(
  getDb: () => Pingable,
  options: { timeoutMs?: number } = {},
): () => Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('timeout'));
        }, timeoutMs);
      });
      await Promise.race([getDb().ping(), timeout]);
      return answer('ok', 200);
    } catch {
      // The reason stays out of the response and the log: a driver error can carry a host name.
      console.error('health: the database did not answer');
      return answer('unavailable', 503);
    } finally {
      clearTimeout(timer);
    }
  };
}
