export type MemorySample = { render: number; bytes: number };

export type SoakVerdict = {
  ok: boolean;
  baselineBytes?: number;
  finalBytes?: number;
  limitBytes?: number;
  message: string;
};

export function checkSoak(_samples: readonly MemorySample[]): SoakVerdict {
  return { ok: true, message: '' };
}
