// Stub: the settings arrive in the next commit.
export type ProcessName = 'web' | 'worker' | 'fetcher' | 'migrate' | 'seed';

export const settings: Record<string, unknown> = {};

export function loadEnv(
  processName: ProcessName,
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  void processName;
  void source;
  return {};
}
