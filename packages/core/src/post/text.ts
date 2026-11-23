import { z } from 'zod';

/** Text that has to say something: trimmed, and not empty. */
export const text = z.string().trim().min(1);
