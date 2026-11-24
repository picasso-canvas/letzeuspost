// Exact pixel comparison for the golden renders (§08: no tolerance).

export type Pixels = { width: number; height: number; rgba: Uint8Array };

export type Comparison = {
  equal: boolean;
  width: number;
  height: number;
  differing: number;
  diff?: Uint8Array;
  size?: string;
};

export function decodePng(_png: Uint8Array): Pixels {
  throw new Error('not built yet');
}

export function encodePng(_image: Pixels): Uint8Array {
  throw new Error('not built yet');
}

export function comparePng(_baseline: Uint8Array, _render: Uint8Array): Comparison {
  throw new Error('not built yet');
}
