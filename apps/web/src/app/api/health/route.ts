import { appDb } from '../../../server/db.ts';
import { createHealthHandler } from './handler.ts';

// §13: nothing here is cached or prerendered; every request asks the database.
export const dynamic = 'force-dynamic';

export const GET = createHealthHandler(appDb);
