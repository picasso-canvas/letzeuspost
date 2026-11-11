import { appDb } from '../../../server/db.ts';
import { createHealthHandler } from './handler.ts';

export const GET = createHealthHandler(appDb);
