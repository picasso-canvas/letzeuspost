// The signed-in pages' guard and the switcher's action (#79), with packages/auth's guard and Next's request stood in
// for: where each refusal sends a page, and that the action always runs the guard and never trusts the id it is sent.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  open: vi.fn(),
  switchTo: vi.fn(),
  request: new Headers({ cookie: 'better-auth.session_token=t' }),
}));

vi.mock('@lzp/auth', () => ({
  guard: () => ({ open: fake.open, switchTo: fake.switchTo }),
}));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(fake.request) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

const { inWorkspace } = await import('./workspace.ts');
const { switchWorkspace } = await import('./actions.ts');

const KITE = '0190a6b2-7c3d-7e4f-8a9b-0c1d2e3f4a5b';
const allowed = {
  ok: true,
  person: { userId: 'u', name: 'Nadia Karim', email: 'nadia@northwind.invalid' },
  session: { token: 't', userId: 'u' },
  workspace: { id: KITE, name: 'Kite & Co', slug: 'kite', role: 'editor' },
  workspaces: [],
};

beforeEach(() => {
  fake.open.mockReset();
  fake.switchTo.mockReset();
});

describe('a page under /app', () => {
  it('opens in the workspace the guard gives, from the request’s own headers', async () => {
    fake.open.mockResolvedValue(allowed);
    expect(await inWorkspace()).toBe(allowed);
    expect(fake.open).toHaveBeenCalledWith(fake.request);
  });

  it('sends a request with no session to /sign-in', async () => {
    fake.open.mockResolvedValue({ ok: false, refused: 'no-session' });
    await expect(inWorkspace()).rejects.toThrow('redirect /sign-in');
  });

  it('sends a person with no workspace, or none they still belong to, to `/`, never back to /sign-in', async () => {
    fake.open.mockResolvedValue({ ok: false, refused: 'no-workspace' });
    await expect(inWorkspace()).rejects.toThrow(/^redirect \/$/);
    fake.open.mockResolvedValue({ ok: false, refused: 'not-a-member' });
    await expect(inWorkspace()).rejects.toThrow(/^redirect \/$/);
  });
});

describe('the switcher’s action', () => {
  it('asks the guard to switch the session to the chosen workspace', async () => {
    fake.switchTo.mockResolvedValue({ ok: true });
    expect(await switchWorkspace(KITE)).toEqual({ ok: true });
    expect(fake.switchTo).toHaveBeenCalledWith(fake.request, KITE);
  });

  it('says no when the guard refuses, and nothing more (no reason for the browser)', async () => {
    fake.switchTo.mockResolvedValue({ ok: false, refused: 'not-a-member' });
    expect(await switchWorkspace(KITE)).toEqual({ ok: false });
  });

  it('runs the guard even for something that isn’t a workspace id, which no membership matches', async () => {
    fake.switchTo.mockResolvedValue({ ok: false, refused: 'not-a-member' });
    for (const sent of ['not-an-id', 42, null, { id: KITE }]) {
      expect(await switchWorkspace(sent)).toEqual({ ok: false });
    }
    expect(fake.switchTo.mock.calls).toEqual(Array(4).fill([fake.request, '']));
  });
});
