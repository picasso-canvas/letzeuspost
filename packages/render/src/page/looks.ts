import type { LookName } from '@lzp/core';
import { LookDefinitionSchema, type LookDefinition } from '../kit.ts';

// The looks the renderer knows (§08): each one registers itself, with its CSS and tokens, when its module is loaded
// (the real looks come in their own tasks, `src/looks/**`). `buildSlide` asks for the post's look by name.
const registered = new Map<LookName, LookDefinition>();

export function registerLook(definition: LookDefinition): void {
  const look = LookDefinitionSchema.parse(definition);
  if (registered.has(look.name)) throw new Error(`The look "${look.name}" is already registered`);
  registered.set(look.name, look);
}

export const getLook = (name: LookName): LookDefinition | undefined => registered.get(name);
