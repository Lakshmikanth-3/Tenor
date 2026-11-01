// Minimal typing for `bun test` (run with `bun run test`), so the unit tests typecheck without extra dependencies.
declare module 'bun:test' {
  type Fn = () => void | Promise<void>
  export const describe: (name: string, fn: () => void) => void
  export const test: (name: string, fn: Fn) => void
  interface Matchers {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toContain(expected: unknown): void
    toBeUndefined(): void
    toBeGreaterThanOrEqual(n: number): void
    toBeLessThan(n: number): void
    toBeGreaterThan(n: number): void
    toBeTruthy(): void
    toBeFalsy(): void
    toHaveLength(n: number): void
  }
  export const expect: (actual: unknown) => Matchers
}
