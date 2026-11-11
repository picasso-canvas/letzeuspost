export function newNonce(): string {
  throw new Error('not implemented');
}

export function contentSecurityPolicy(
  nonce: string,
  options: { development: boolean; https?: boolean },
): string {
  throw new Error(`not implemented: ${nonce} ${String(options.development)}`);
}
