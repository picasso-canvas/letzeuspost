// The slice of React that the page builder uses. @types/react isn't installed for this package and its tsconfig has no
// `jsx` option (both outside #331's Areas), so the page is written with `createElement` and these types. Replace this
// file with `@types/react` and `@types/react-dom` when the package gets them.
declare module 'react' {
  export type ReactNode = string | number | boolean | null | undefined | ReactElement | ReactNode[];
  export interface ReactElement {
    readonly type: unknown;
  }
  export type FunctionComponent<P> = (props: P) => ReactNode;
  export function createElement(
    type: string,
    props: Readonly<Record<string, unknown>> | null,
    ...children: ReactNode[]
  ): ReactElement;
  export function createElement<P extends object>(
    type: FunctionComponent<P>,
    props: P,
    ...children: ReactNode[]
  ): ReactElement;
}

declare module 'react-dom/server' {
  import type { ReactNode } from 'react';
  export function renderToStaticMarkup(node: ReactNode): string;
}
