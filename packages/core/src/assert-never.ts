/** Marks a branch that the type system says can't happen, such as an unhandled case in a switch. */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
