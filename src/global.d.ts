// Minimal shims to quiet type errors before deps are installed
declare module 'react' {
  export function useState<S = any>(initialState?: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void]
  export function useEffect(effect: () => void | (() => void), deps?: any[]): void
  export function useRef<T = any>(initialValue?: T): { current: T }
  export function useMemo<T = any>(factory: () => T, deps?: any[]): T
  export type FC<P = {}> = (props: P) => any
  const React: any
  export default React
}
declare module 'react-dom/client' {
  export const createRoot: any
}

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any
  }
}
