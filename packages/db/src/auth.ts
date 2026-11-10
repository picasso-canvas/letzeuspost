// The auth-only export (#71, Q5): written next.
export interface AuthDb {
  forUser: (ctx: { userId: string }) => {
    transaction: <T>(work: (tx: never) => Promise<T>) => Promise<T>;
  };
  close: () => Promise<void>;
}

export function createAuthDb(_url: string): AuthDb {
  return { close: () => Promise.resolve() } as AuthDb;
}
