// Sign-in (#77, §13 Sign-in and sessions): Better Auth's routes, from packages/auth, which serves only its
// SERVED_ENDPOINTS here (the email link, the session, sign-out) and answers 404 to the rest. It answers a request for a
// link before doing the known address's work, which Next's `after()` runs once the answer is sent (decision 5).
import { authServer } from '@lzp/auth';
import { after } from 'next/server';

// §13: never cached or prerendered; every request reads its session from the database.
export const dynamic = 'force-dynamic';

export const GET = (request: Request): Promise<Response> => authServer().handler(request, after);
export const POST = GET;
