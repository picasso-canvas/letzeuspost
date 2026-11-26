// An upload round's limits and the storage limit (#403). §06 Reading uploaded files: "PNG, JPG, WebP, SVG, PDF; up to
// 20 MB each, 30 files per brand at a time". §02 Running out, and limits: "Brand, seat and storage limits block adding
// more and suggest the next plan". The plans' amounts live in config/plans.ts, which the caller passes in; the
// database adds up what a workspace stores, with the workspace locked (`startUploads` in @lzp/db).

/** The types a signed upload link may carry (§06), as the browser names them. */
export const UPLOAD_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];

/** §06's "up to 20 MB each"; the worker reads no more than this (@lzp/storage's MAX_PDF_BYTES). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** §06's "30 files per brand at a time". */
export const MAX_FILES_PER_ROUND = 30;
/** A plan's `storageGb` in bytes. */
export const GB = 1024 * 1024 * 1024;

export interface FileToUpload {
  readonly contentType: string;
  readonly size: number;
}

export type RoundCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly refused: 'none' | 'too-many' | 'type' | 'size' | 'too-large';
      readonly message: string;
    };

const isUploadType = (value: string): value is UploadType =>
  (UPLOAD_TYPES as readonly string[]).includes(value);

/** Whether a round of files may be signed: all of it, or none of it. */
export function checkUploadRound(files: readonly FileToUpload[]): RoundCheck {
  if (files.length === 0) {
    return { ok: false, refused: 'none', message: 'Choose at least one file to upload.' };
  }
  if (files.length > MAX_FILES_PER_ROUND) {
    return {
      ok: false,
      refused: 'too-many',
      message: `At most ${String(MAX_FILES_PER_ROUND)} files can be uploaded at a time.`,
    };
  }
  for (const file of files) {
    if (!isUploadType(file.contentType)) {
      return {
        ok: false,
        refused: 'type',
        message: 'Only PNG, JPG, WebP, SVG and PDF files can be uploaded.',
      };
    }
    if (!Number.isInteger(file.size) || file.size <= 0) {
      return { ok: false, refused: 'size', message: 'A file to upload can’t be empty.' };
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return { ok: false, refused: 'too-large', message: 'Each file can be at most 20 MB.' };
    }
  }
  return { ok: true };
}

/** What the storage check needs of a plan. */
export interface StoragePlan {
  readonly name: string;
  readonly storageGb: number;
}

/** The plans, smallest first: the next plan is the one after a workspace's. */
const PLAN_ORDER = ['starter', 'agency', 'scale'] as const;
type PlanId = (typeof PLAN_ORDER)[number];

/**
 * A workspace's plan and the one above it (none above the largest). A workspace whose plan billing hasn't set yet
 * (`workspace.plan` is null) is held to the smallest plan: the plan doesn't say, so #403 asks Zeus (needs-zeus).
 * A plan this list doesn't know is an error, never a guessed limit.
 */
export function storagePlans(
  plans: Readonly<Record<PlanId, StoragePlan>>,
  planId: string | null,
): { plan: StoragePlan; next: StoragePlan | null } {
  const id = planId ?? PLAN_ORDER[0];
  const at = (PLAN_ORDER as readonly string[]).indexOf(id);
  const plan = PLAN_ORDER[at];
  if (plan === undefined) throw new Error('storagePlans: no such plan');
  const next = PLAN_ORDER[at + 1];
  return { plan: plans[plan], next: next === undefined ? null : plans[next] };
}

export type StorageCheck = { readonly ok: true } | { readonly ok: false; readonly message: string };

const bytes = (value: number): number => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`checkStorage: expected a number of bytes, got ${String(value)}`);
  }
  return value;
};

/**
 * Whether `addingBytes` more fit in the plan's storage on top of `usedBytes`. Refused: §02's message, which names the
 * next plan and its storage (on the largest plan, there is none to name).
 */
export function checkStorage(input: {
  readonly plan: StoragePlan;
  readonly next: StoragePlan | null;
  readonly usedBytes: number;
  readonly addingBytes: number;
}): StorageCheck {
  const { plan, next } = input;
  if (bytes(input.usedBytes) + bytes(input.addingBytes) <= plan.storageGb * GB) return { ok: true };
  const past = `These files would go past the ${String(plan.storageGb)} GB of storage in your ${plan.name} plan.`;
  const then =
    next === null
      ? 'Delete some files, or contact us for more.'
      : `The ${next.name} plan has ${String(next.storageGb)} GB.`;
  return { ok: false, message: `${past} ${then}` };
}
