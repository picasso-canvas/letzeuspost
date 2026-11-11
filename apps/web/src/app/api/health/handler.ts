// The health check (§13 The app's API, §14 Deploys: the deploy checks it and rolls back when it fails). It answers
// whether the app can reach its database, and nothing else: no error text, no setting, no person.

export interface Pingable {
  ping: () => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 3000;

type Outcome = 'ok' | 'timeout' | 'error';

function answer(status: 'ok' | 'unavailable', code: number): Response {
  // Never cached: a deploy's check must see the database as it is now.
  return Response.json({ status }, { status: code, headers: { 'cache-control': 'no-store' } });
}

async function check(getDb: () => Pingable, timeoutMs: number): Promise<Outcome> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timeout');
      }, timeoutMs);
    });
    // An async function, so a handle that throws while being set up is an `error` too; it starts at once.
    const ping = (async (): Promise<'ok'> => {
      await getDb().ping();
      return 'ok';
    })();
    return await Promise.race([ping, timeout]);
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

export function createHealthHandler(
  getDb: () => Pingable,
  options: { timeoutMs?: number } = {},
): () => Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // The check that is running now. Requests that arrive while it runs share it, so a flood of health requests during
  // an outage costs the app's pool one ping, not one per request.
  let running: Promise<Outcome> | undefined;
  return async () => {
    running ??= check(getDb, timeoutMs).finally(() => {
      running = undefined;
    });
    const outcome = await running;
    if (outcome === 'ok') return answer('ok', 200);
    // Only a fixed category is logged: a driver's message can carry a host name or a password.
    console.error(`health: the database did not answer (${outcome})`);
    return answer('unavailable', 503);
  };
}
