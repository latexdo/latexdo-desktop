/* eslint-disable @typescript-eslint/no-explicit-any */
// Wrappers for partially mocked modules. They import nothing, so a mock
// factory for a Node built-in can use them without importing that built-in
// again, and read the shared harness state only when called.
type Fn = (...args: any[]) => any;
const state = (): any => (globalThis as any).__latexdoMainHarness;

/** Delegates to a harness override when one is set, else to the original. */
export function overridable<T extends Record<string, any>>(
  original: T,
  prefix: string,
  names: (keyof T & string)[],
): T {
  const wrapped: Record<string, unknown> = { ...original };
  for (const name of names) {
    wrapped[name] = (...args: unknown[]) =>
      ((state()?.overrides[`${prefix}.${name}`] as Fn | undefined) ?? original[name])(
        ...args,
      );
  }
  return wrapped as T;
}

export function wrapFsPromises<T extends Record<string, any>>(original: T): T {
  const wrapped: Record<string, unknown> = { ...original };
  for (const name of ["stat", "lstat", "readFile", "access"] as const) {
    wrapped[name] = (...args: unknown[]) => {
      const hooked = state()?.fsHooks[name]?.(...args);
      return hooked !== undefined ? hooked : original[name](...args);
    };
  }
  return wrapped as T;
}

export function wrapFs<T extends Record<string, any>>(original: T): T {
  return {
    ...original,
    watch: (...args: unknown[]) => (state()?.watch ?? original.watch)(...args),
  } as T;
}

export function wrapChildProcess<T extends Record<string, any>>(original: T): T {
  return {
    ...original,
    spawn: (...args: unknown[]) => (state()?.spawn ?? original.spawn)(...args),
  } as T;
}

export function wrapGit<T extends Record<string, any>>(original: T): T {
  return {
    ...original,
    runGitText: (...args: unknown[]) =>
      (state()?.runGitText ?? original.runGitText)(...args),
  } as T;
}

export function wrapDiagnostics<T extends Record<string, any>>(original: T): T {
  return {
    ...original,
    createDiagnosticReporter: (options: unknown) => {
      const reporter = original.createDiagnosticReporter(options);
      const fail = () => state()?.diagnosticsFail ?? {};
      return {
        logPath: () => {
          if (fail().logPath) throw new Error("no log path");
          return reporter.logPath();
        },
        record: async (...args: unknown[]) => {
          if (fail().record) throw new Error("diagnostic write failed");
          return reporter.record(...args);
        },
        recordSync: (...args: unknown[]) => {
          if (fail().recordSync) throw new Error("diagnostic write failed");
          return reporter.recordSync(...args);
        },
      };
    },
  } as T;
}
