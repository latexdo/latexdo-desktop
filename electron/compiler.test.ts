// @vitest-environment node
import { EventEmitter } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
  default: { spawn: mocks.spawn },
}));

type CompilerModule = typeof import("./compiler.js");

const originalPlatform = process.platform;
const originalPath = process.env.PATH;
const originalPathExt = process.env.PATHEXT;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

/** Loads a fresh copy so the platform-dependent candidate lists are rebuilt. */
async function loadCompiler(platform: NodeJS.Platform): Promise<CompilerModule> {
  setPlatform(platform);
  vi.resetModules();
  return import("./compiler.js");
}

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number | undefined;
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild(pid: number | undefined = 4242): FakeChild {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    pid,
    kill: vi.fn(),
  });
}

/** Queues a child that writes `chunks` and then closes with `code`. */
function spawnsChild(
  options: {
    chunks?: string[];
    stderr?: string[];
    code?: number | null;
    pid?: number;
  } = {},
): FakeChild {
  const child = fakeChild(options.pid);
  mocks.spawn.mockImplementationOnce(() => {
    setTimeout(() => {
      for (const chunk of options.chunks ?? [])
        child.stdout.emit("data", Buffer.from(chunk));
      for (const chunk of options.stderr ?? [])
        child.stderr.emit("data", Buffer.from(chunk));
      if (options.code !== undefined) child.emit("close", options.code);
    }, 0);
    return child;
  });
  return child;
}

let directory: string;
let root: string;
let compiler: CompilerModule;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-compiler-"));
  root = path.join(directory, "project");
  await mkdir(root);
  mocks.spawn.mockReset();
  compiler = await loadCompiler(originalPlatform);
});

afterEach(async () => {
  setPlatform(originalPlatform);
  process.env.PATH = originalPath;
  if (originalPathExt === undefined) delete process.env.PATHEXT;
  else process.env.PATHEXT = originalPathExt;
  vi.restoreAllMocks();
  vi.useRealTimers();
  await chmod(path.join(root, "locked"), 0o755).catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
});

async function makeExecutable(file: string, mode = 0o755) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "#!/bin/sh\n");
  await chmod(file, mode);
  return file;
}

describe.skipIf(originalPlatform === "win32")("executable lookup", () => {
  it("accepts executable absolute or relative-with-separator candidates only", async () => {
    const tool = await makeExecutable(path.join(directory, "bin", "tool"));
    const plain = await makeExecutable(path.join(directory, "bin", "plain"), 0o644);
    expect(await compiler.resolveExecutable([plain, tool])).toBe(tool);
    expect(await compiler.resolveExecutable([plain])).toBeNull();
    expect(await compiler.resolveExecutable(["sub\\missing"])).toBeNull();
    expect(await compiler.resolveExecutable([])).toBeNull();
  });

  it("searches PATH entries, skipping blanks", async () => {
    const binA = path.join(directory, "a");
    const binB = path.join(directory, "b");
    await mkdir(binA);
    const tool = await makeExecutable(path.join(binB, "mytool"));
    process.env.PATH = ["", ` ${binA} `, binB].join(path.delimiter);
    expect(await compiler.resolveExecutable(["missing", "mytool"])).toBe(tool);
    delete process.env.PATH;
    expect(await compiler.resolveExecutable(["mytool"])).toBeNull();
  });

  it("tries PATHEXT extensions on Windows", async () => {
    const bin = path.join(directory, "win");
    const exe = await makeExecutable(path.join(bin, "tool.EXE"));
    process.env.PATH = bin;
    setPlatform("win32");
    process.env.PATHEXT = " .COM ; .EXE;";
    expect(await compiler.resolveExecutable(["tool"])).toBe(exe);
    // An explicit extension is used as-is.
    expect(await compiler.resolveExecutable(["tool.EXE"])).toBe(exe);
    // An empty PATHEXT falls back to the bare name.
    process.env.PATHEXT = " ; ";
    expect(await compiler.resolveExecutable(["tool"])).toBeNull();
    delete process.env.PATHEXT;
    expect(await compiler.resolveExecutable(["tool"])).toBe(exe);
  });

  it("falls back to the LatexDo-installed TeX bin directory", async () => {
    const bundledDir = path.join(directory, "bundled");
    const latexmk = await makeExecutable(path.join(bundledDir, "latexmk"));
    process.env.PATH = "";
    expect(await compiler.findTexExecutable("latexmk")).toBeNull();
    compiler.setBundledTexBinLocator(async () => bundledDir);
    expect(await compiler.findTexExecutable("latexmk")).toBe(latexmk);
    expect(await compiler.findTexExecutable("biber")).toBeNull();
  });

  it("finds latexmk on PATH on non-macOS platforms", async () => {
    compiler = await loadCompiler("linux");
    const bin = path.join(directory, "linuxbin");
    const latexmk = await makeExecutable(path.join(bin, "latexmk"));
    process.env.PATH = bin;
    expect(await compiler.findLatexmk()).toBe(latexmk);
  });

  it("checks the MacTeX locations first on macOS", async () => {
    compiler = await loadCompiler("darwin");
    const bin = path.join(directory, "macbin");
    await makeExecutable(path.join(bin, "latexmk"));
    process.env.PATH = bin;
    const found = await compiler.findLatexmk();
    expect(found === path.join(bin, "latexmk") || found?.startsWith("/")).toBe(true);
  });
});

describe("texToolPath", () => {
  it("prefixes the executable directory and the macOS TeX bin", () => {
    process.env.PATH = "/usr/bin";
    setPlatform("darwin");
    expect(compiler.texToolPath("/opt/tex/latexmk").split(path.delimiter)).toEqual([
      "/opt/tex",
      "/Library/TeX/texbin",
      "/usr/bin",
    ]);
    setPlatform("linux");
    expect(compiler.texToolPath("latexmk")).toBe("/usr/bin");
    delete process.env.PATH;
    expect(compiler.texToolPath("latexmk")).toBe("");
  });
});

describe("parseDiagnostics", () => {
  const parse = (output: string) => compiler.parseDiagnostics(output, root, "main.tex");

  it("reads file:line:column errors and warnings, deduplicated", () => {
    const output = [
      `${path.join(root, "chap.tex")}:12:3: ! Undefined control sequence.`,
      "main.tex:4: Package foo Warning: something odd",
      "main.tex:4: Package foo Warning: something odd",
    ].join("\n");
    const diagnostics = parse(output);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      file: "chap.tex",
      line: 12,
      column: 3,
      severity: "error",
      message: "Undefined control sequence.",
    });
    expect(diagnostics[1]).toMatchObject({ line: 4, column: 1, severity: "warning" });
  });

  it("joins multi-line package warnings and finds their input line", () => {
    const output = [
      "Package hyperref Warning: Token not allowed in a PDF string",
      "(hyperref)                removing `\\textbf' on input line 27.",
      "LaTeX Warning: Reference `x' undefined",
      "    continues here.",
      "Class article Warning: a",
      "main.tex:1: stop",
      "LaTeX Warning: b",
      "! next",
      "LaTeX Warning: c",
      "plain text stops",
    ].join("\n");
    const diagnostics = parse(output);
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    expect(warnings[0]).toMatchObject({
      line: 27,
      message: "Token not allowed in a PDF string removing `\\textbf' on input line 27",
    });
    expect(warnings[1].message).toBe("Reference `x' undefined continues here");
    expect(warnings.map((w) => w.message)).toEqual(
      expect.arrayContaining(["a", "b", "c"]),
    );
  });

  it("reads over/underfull box warnings with line ranges", () => {
    const diagnostics = parse(
      [
        "Overfull \\hbox (3.0pt too wide) in paragraph at lines 10--14",
        "Underfull \\vbox (badness 10000) has occurred while \\output is active",
        "Underfull \\hbox (badness 1000) at line 7",
      ].join("\n"),
    );
    expect(diagnostics.map((d) => [d.line, d.endLine])).toEqual([
      [10, 14],
      [1, undefined],
      [7, undefined],
    ]);
  });

  it("locates ! errors through the following l.N line, including runaway arguments", () => {
    const output = [
      "Runaway argument?",
      "{abc",
      "! Paragraph ended before \\textbf was complete.",
      "<to be read again>",
      "l.42 ",
      "",
      "! Missing $ inserted.",
      "no location here",
    ].join("\n");
    const diagnostics = parse(output);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      line: 42,
      severity: "error",
      message: "Runaway argument? Paragraph ended before \\textbf was complete.",
    });
    expect(diagnostics[0].compilerExcerpt).toContain("{abc");
  });

  it("stops the runaway lookback at an earlier error", () => {
    const diagnostics = parse(["! First.", "! Second.", "l.3 x"].join("\n"));
    expect(diagnostics.map((d) => d.message)).toEqual(["First.", "Second."]);
  });

  it("explains failing bibliography tools", () => {
    const output = [
      "Latexmk: Error return from 'biber main'",
      "ERROR - Cannot find 'refs.bib'!",
      "biber: something",
      "I couldn't open database file refs.bib",
      "unrelated",
    ].join("\n");
    const [diagnostic] = parse(output);
    expect(diagnostic.message).toBe(
      "biber failed, so the bibliography or index could not be built.",
    );
    expect(diagnostic.compilerExcerpt?.split("\n")).toHaveLength(4);
  });

  it("does not add the tool failure when a TeX error already exists", () => {
    const diagnostics = parse(
      ["main.tex:2: ! Bad.", "Latexmk: Error return from 'bibtex main'"].join("\n"),
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("falls back to the first explicit problem without a line", () => {
    expect(
      parse("\n\nLaTeX Error: File `x.sty' not found.\nl.5 \\usepackage")[0],
    ).toMatchObject({
      line: 5,
      message: "LaTeX Error: File `x.sty' not found.",
      locationAccuracy: "inferred",
    });
    expect(parse("Runaway argument?\n{text")[0]).toMatchObject({
      line: 1,
      message: "Runaway argument?",
    });
    expect(parse("prefix\n! Emergency stop.\n?\nafter")[0]).toMatchObject({
      message: "Emergency stop.",
      compilerExcerpt: "! Emergency stop.\n?",
    });
    expect(parse("Runaway argument?\n! Oops.\n! Again.")[0]).toMatchObject({
      message: "Runaway argument?",
      compilerExcerpt: "Runaway argument?\n! Oops.",
    });
    expect(parse("all fine")).toEqual([]);
  });

  it("caps the number of diagnostics", () => {
    const output = Array.from(
      { length: 150 },
      (_, i) => `main.tex:${i + 1}: ! e${i}`,
    ).join("\n");
    expect(parse(output)).toHaveLength(100);
  });
});

describe("estimateCompileProgress", () => {
  const p = compilerProgress;
  function compilerProgress(output: string) {
    return compiler.estimateCompileProgress(output);
  }

  it("handles terminal states", () => {
    expect(p("Latexmk: All targets are up-to-date")).toBe(100);
    expect(p("Latexmk: Errors, so I did not complete making targets")).toBe(92);
    expect(p("")).toBe(0);
  });

  it("walks startup milestones", () => {
    expect(p("Latexmk: This is Latexmk")).toBe(4);
    expect(p("Latexmk: This is Latexmk\nLatexmk: applying rule 'pdflatex'")).toBe(10);
    expect(p("entering extended mode")).toBe(10);
    expect(p("LaTeX2e <2024>")).toBe(10);
  });

  it("fills each engine pass by pages and snaps on output written", () => {
    const pass1 = "Latexmk: Run number 1 of rule 'pdflatex'\n";
    expect(p(pass1)).toBe(10);
    expect(p(`${pass1}[1]\n[6]`)).toBe(18);
    expect(p(`${pass1}[30]`)).toBe(26);
    expect(p(`${pass1}Output written on main.pdf (3 pages, 100 bytes)`)).toBe(26);
    expect(p("Latexmk: Run number 9 of rule 'lualatex'\n")).toBe(86);
  });

  it("prefers later applied rules over an earlier numbered run", () => {
    const output = [
      "Latexmk: Run number 1 of rule 'pdflatex'",
      "Latexmk: applying rule 'pdflatex'",
      "Latexmk: applying rule 'pdflatex'",
    ].join("\n");
    expect(p(output)).toBe(26);
    expect(
      p("Latexmk: applying rule 'xelatex'\nLatexmk: Run number 1 of rule 'xelatex'"),
    ).toBe(10);
  });

  it("bumps for bibliography rules by pass", () => {
    expect(p("Latexmk: Run number 1 of rule 'biber'")).toBe(46);
    const twoPasses =
      "Latexmk: Run number 2 of rule 'pdflatex'\nLatexmk: Run number 1 of rule 'bibtex'";
    expect(p(twoPasses)).toBe(60);
    expect(
      p(
        "Latexmk: Run number 3 of rule 'pdflatex'\nLatexmk: Run number 1 of rule 'makeindex'",
      ),
    ).toBe(70);
    expect(
      p(
        "Latexmk: Run number 4 of rule 'pdflatex'\nLatexmk: Run number 1 of rule 'biber'",
      ),
    ).toBe(74);
    expect(
      p(
        "Latexmk: Run number 6 of rule 'pdflatex'\nLatexmk: Run number 1 of rule 'biber'",
      ),
    ).toBe(78);
  });
});

describe("materializeCloudCompileFiles", () => {
  it("mirrors files, replacing old content but keeping build caches", async () => {
    const scratch = path.join(directory, "scratch");
    await mkdir(path.join(scratch, ".latexdo"), { recursive: true });
    await writeFile(path.join(scratch, "stale.tex"), "old");
    await compiler.materializeCloudCompileFiles(scratch, [
      { relativePath: "main.tex", content: "hello" },
      { relativePath: "fig\\a.png", bytes: new Uint8Array([1, 2, 3]) },
      { relativePath: "empty.tex" },
    ]);
    expect((await readdir(scratch)).sort()).toEqual([
      ".latexdo",
      "empty.tex",
      "fig",
      "main.tex",
    ]);
    expect(await readFile(path.join(scratch, "main.tex"), "utf8")).toBe("hello");
    expect([...(await readFile(path.join(scratch, "fig", "a.png")))]).toEqual([
      1, 2, 3,
    ]);
    expect(await readFile(path.join(scratch, "empty.tex"), "utf8")).toBe("");
  });

  it.each([
    "",
    "/abs.tex",
    "C:evil.tex",
    "a\u0001b.tex",
    "a//b.tex",
    "./a.tex",
    "../a.tex",
    "a/c:/b.tex",
    "x".repeat(1025),
  ])("rejects unsafe path %j", async (relativePath) => {
    await expect(
      compiler.materializeCloudCompileFiles(path.join(directory, "s"), [
        { relativePath, content: "" },
      ]),
    ).rejects.toThrow("Unsafe project path");
  });

  it("enforces file count and size limits", async () => {
    const target = path.join(directory, "s");
    await expect(
      compiler.materializeCloudCompileFiles(
        target,
        Array.from({ length: compiler.maxCloudCompileFiles + 1 }, (_, i) => ({
          relativePath: `f${i}`,
        })),
      ),
    ).rejects.toThrow("too many files");
    const big = { byteLength: compiler.maxCloudCompileFileBytes + 1 };
    const huge = Object.setPrototypeOf(big, Uint8Array.prototype) as Uint8Array;
    await expect(
      compiler.materializeCloudCompileFiles(target, [
        { relativePath: "big.pdf", bytes: huge },
      ]),
    ).rejects.toThrow("big.pdf is too large");
    const nearLimit = Object.setPrototypeOf(
      { byteLength: compiler.maxCloudCompileFileBytes },
      Uint8Array.prototype,
    ) as Uint8Array;
    await expect(
      compiler.materializeCloudCompileFiles(
        target,
        Array.from({ length: 9 }, (_, i) => ({
          relativePath: `p${i}.pdf`,
          bytes: nearLimit,
        })),
      ),
    ).rejects.toThrow("Shared project is too large");
  });
});

describe("compileLatex", () => {
  const request = () => ({
    projectPath: root,
    rootFile: "main.tex",
    engine: "xelatex" as const,
  });

  it("reports a missing toolchain", async () => {
    compiler = await loadCompiler("linux");
    process.env.PATH = "";
    const result = await compiler.compileLatex(request());
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe("missing-latex-toolchain");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("does not start when already canceled", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await compiler.compileLatex(request(), {
      executable: "latexmk",
      signal: controller.signal,
    });
    expect(result.error).toBe("LaTeX compile canceled.");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("builds into a fresh job folder and reports the PDF", async () => {
    await mkdir(path.join(root, "chapters", "deep"), { recursive: true });
    await mkdir(path.join(root, "node_modules"));
    await mkdir(path.join(root, ".hidden"));
    await writeFile(path.join(root, "file.txt"), "");
    // An unreadable folder is mirrored but not descended into.
    await mkdir(path.join(root, "locked", "inner"), { recursive: true });
    await chmod(path.join(root, "locked"), 0o000);
    spawnsChild({
      chunks: ["Latexmk: This is Latexmk\n"],
      stderr: ["main.tex:1: LaTeX Warning: hm\n"],
      code: 0,
    });
    const progress: number[] = [];
    const result = await compiler.compileLatex(request(), {
      executable: "/opt/tex/latexmk",
      onProgress: (value) => progress.push(value),
    });
    const [executable, args, options] = mocks.spawn.mock.calls[0];
    expect(executable).toBe("/opt/tex/latexmk");
    expect(args[0]).toBe("-xelatex");
    expect(args.at(-1)).toBe(path.join(root, "main.tex"));
    const outdir = args.find((arg: string) => arg.startsWith("-outdir="))!.slice(8);
    expect(options.env.PATH.split(path.delimiter)[0]).toBe("/opt/tex");
    expect(result.ok).toBe(true);
    expect(result.pdfPath).toBe(path.join(outdir, "main.pdf"));
    expect(result.diagnostics[0].severity).toBe("warning");
    expect(progress).toEqual([4, 100]);
    await chmod(path.join(root, "locked"), 0o755);
    expect((await readdir(outdir)).sort()).toEqual(["chapters", "locked"]);
    expect(await readdir(path.join(outdir, "locked"))).toEqual([]);
    expect(await readdir(path.join(outdir, "chapters"))).toEqual(["deep"]);
  });

  it("throttles repeated progress updates", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const child = fakeChild();
    mocks.spawn.mockReturnValueOnce(child);
    const progress: number[] = [];
    const done = compiler.compileLatex(request(), {
      executable: "latexmk",
      onProgress: (value) => progress.push(value),
    });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
    child.stdout.emit("data", Buffer.from("Latexmk: This is Latexmk\n"));
    child.stdout.emit("data", Buffer.from("x"));
    now += 50;
    child.stdout.emit(
      "data",
      Buffer.from("Latexmk: Run number 1 of rule 'pdflatex'\n"),
    );
    now += 200;
    child.stdout.emit("data", Buffer.from("[12]\n"));
    child.emit("close", 0);
    child.emit("close", 0);
    await done;
    expect(progress).toEqual([4, 26, 100]);
  });

  it("enriches failure diagnostics from source files", async () => {
    await writeFile(path.join(root, "main.tex"), "\\begin{document}\n\\foo\n");
    spawnsChild({
      chunks: [
        "main.tex:2: Undefined control sequence.\nmissing.tex:3: ! Bad.\nmain.tex:2: ! Another\n",
      ],
      code: 12,
    });
    const result = await compiler.compileLatex(request(), { executable: "latexmk" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("LaTeX exited with code 12.");
    expect(result.diagnostics.map((d) => d.file).sort()).toEqual([
      "main.tex",
      "main.tex",
      "missing.tex",
    ]);
  });

  it("reports an unknown exit code and spawn errors once", async () => {
    spawnsChild({ code: null });
    expect(
      (await compiler.compileLatex(request(), { executable: "latexmk" })).error,
    ).toBe("LaTeX exited with code unknown.");
    const child = fakeChild();
    mocks.spawn.mockReturnValueOnce(child);
    const done = compiler.compileLatex(request(), { executable: "latexmk" });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2));
    child.emit("error", new Error("spawn ENOENT"));
    child.emit("close", 1);
    child.emit("close", 0);
    expect((await done).error).toBe("spawn ENOENT");
  });

  it("strips the stale latexmk failure banner", async () => {
    const stale = [
      "Rc files read:",
      "  NONE",
      "Latexmk: This is Latexmk, John Collins",
      "Latexmk: Nothing to do for 'main.tex'.",
      "Latexmk: All targets (main.pdf) are up-to-date",
      "Collected error summary (may duplicate other messages):",
      "  pdflatex: gave an error in previous invocation of latexmk.",
      "Latexmk: Sometimes, the -f option can be used to get latexmk",
      "  to try to force complete processing.",
      "  But normally, you will need to correct the file(s) that caused the",
      "  error, and then rerun latexmk.",
      "  In some cases, it is best to clean out generated files before rerunning",
      "  latexmk after you've corrected the files.",
      "",
    ];
    spawnsChild({ chunks: [stale.join("\n")], code: 12 });
    const result = await compiler.compileLatex(request(), { executable: "latexmk" });
    expect(result.output).toBe(
      "LatexDo forced a fresh compile because latexmk was stuck on a previous failed run.",
    );
    spawnsChild({ chunks: [[...stale, "keep me"].join("\r\n")], code: 12 });
    expect(
      (await compiler.compileLatex(request(), { executable: "latexmk" })).output,
    ).toBe("keep me");
  });

  it("times out, terminating the process group, then force-kills", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const child = fakeChild(77);
    mocks.spawn.mockReturnValueOnce(child);
    const result = compiler.compileLatex(request(), {
      executable: "latexmk",
      timeoutMs: 5,
      killGraceMs: 5,
    });
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(-77, "SIGKILL"));
    expect(kill).toHaveBeenCalledWith(-77, "SIGTERM");
    child.emit("close", null);
    expect((await result).error).toBe("LaTeX compile timed out after 1 second.");
  });

  it("uses plural seconds and falls back to child.kill when group kill fails", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const child = fakeChild(5);
    child.kill.mockImplementation(() => {
      throw new Error("gone");
    });
    mocks.spawn.mockReturnValueOnce(child);
    const result = compiler.compileLatex(request(), { executable: "latexmk" });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
    vi.advanceTimersByTime(60_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    vi.advanceTimersByTime(2_500);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
    child.emit("close", 0);
    expect((await result).error).toBe("LaTeX compile timed out after 60 seconds.");
  });

  it("kills the direct child on Windows and skips children without a pid", async () => {
    const processKill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const controller = new AbortController();
    const child = fakeChild(9);
    mocks.spawn.mockReturnValueOnce(child);
    setPlatform("win32");
    const result = compiler.compileLatex(request(), {
      executable: "latexmk",
      signal: controller.signal,
      killGraceMs: 1,
    });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
    expect(mocks.spawn.mock.calls[0][2].detached).toBe(false);
    controller.abort();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith("SIGKILL"));
    expect(processKill).not.toHaveBeenCalled();
    child.emit("close", 0);
    expect((await result).error).toBe("LaTeX compile canceled.");

    setPlatform(originalPlatform);
    const noPid = fakeChild(undefined);
    noPid.pid = undefined;
    mocks.spawn.mockReturnValueOnce(noPid);
    const second = new AbortController();
    const pending = compiler.compileLatex(request(), {
      executable: "latexmk",
      signal: second.signal,
    });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2));
    second.abort();
    expect(noPid.kill).not.toHaveBeenCalled();
    noPid.emit("close", 1);
    expect((await pending).error).toBe("LaTeX compile canceled.");
  });
});

describe("compileAsymptote", () => {
  const request = () => ({ projectPath: root, relativePath: "fig/draw.asy" });

  it("reports a missing toolchain", async () => {
    compiler = await loadCompiler("linux");
    process.env.PATH = "";
    const result = await compiler.compileAsymptote(request());
    expect(result.diagnostics[0].code).toBe("missing-asymptote-toolchain");
  });

  it("finds asy on macOS candidates and PATH", async () => {
    compiler = await loadCompiler("darwin");
    const bin = path.join(directory, "asybin");
    await makeExecutable(path.join(bin, "asy"));
    process.env.PATH = bin;
    spawnsChild({ code: 0 });
    const result = await compiler.compileAsymptote(request());
    expect(result.ok).toBe(true);
  });

  it("does not start when already canceled", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await compiler.compileAsymptote(request(), {
      executable: "asy",
      signal: controller.signal,
    });
    expect(result.error).toBe("LaTeX compile canceled.");
  });

  it("renders to a PDF in a fresh build folder", async () => {
    spawnsChild({ chunks: ["ok"], stderr: ["!"], code: 0 });
    const result = await compiler.compileAsymptote(request(), { executable: "asy" });
    const args = mocks.spawn.mock.calls[0][1];
    expect(args.slice(0, 2)).toEqual(["-f", "pdf"]);
    expect(result).toMatchObject({ ok: true, output: "ok!", diagnostics: [] });
    expect(result.pdfPath).toBe(`${args[3]}.pdf`);
    expect(path.basename(result.pdfPath!)).toBe("draw.pdf");
  });

  it("parses failure locations", async () => {
    spawnsChild({ chunks: ["draw.asy: 4.7: syntax error\nmore"], code: 1 });
    let result = await compiler.compileAsymptote(request(), { executable: "asy" });
    expect(result.error).toBe("Asymptote exited with code 1.");
    expect(result.diagnostics[0]).toMatchObject({
      line: 4,
      column: 7,
      message: "draw.asy: 4.7: syntax error",
      locationAccuracy: "line",
    });

    spawnsChild({ chunks: ["fatal problem"], code: null });
    result = await compiler.compileAsymptote(request(), { executable: "asy" });
    expect(result.error).toBe("Asymptote exited with code unknown.");
    expect(result.diagnostics[0]).toMatchObject({
      line: 1,
      column: 1,
      locationAccuracy: "inferred",
    });

    spawnsChild({ chunks: ["line 0"], code: 2 });
    result = await compiler.compileAsymptote(request(), { executable: "asy" });
    expect(result.diagnostics[0]).toMatchObject({ line: 1, column: 1 });

    spawnsChild({ code: 3 });
    result = await compiler.compileAsymptote(request(), { executable: "asy" });
    expect(result.diagnostics).toEqual([]);
  });

  it("reports spawn errors as diagnostics", async () => {
    const child = fakeChild();
    mocks.spawn.mockReturnValueOnce(child);
    const done = compiler.compileAsymptote(request(), { executable: "asy" });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
    child.emit("error", new Error("spawn asy ENOENT"));
    child.emit("close", 1);
    child.emit("close", 0);
    const result = await done;
    expect(result.error).toBe("spawn asy ENOENT");
    expect(result.diagnostics[0].message).toBe("spawn asy ENOENT");
  });

  it("times out and cancels", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const child = fakeChild(31);
    mocks.spawn.mockReturnValueOnce(child);
    const timedOut = compiler.compileAsymptote(request(), {
      executable: "asy",
      timeoutMs: 2_500,
      killGraceMs: 1,
    });
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(-31, "SIGKILL"), {
      timeout: 5_000,
    });
    child.emit("close", null);
    expect((await timedOut).error).toBe("LaTeX compile timed out after 3 seconds.");

    const controller = new AbortController();
    const second = fakeChild(32);
    mocks.spawn.mockReturnValueOnce(second);
    const canceled = compiler.compileAsymptote(request(), {
      executable: "asy",
      signal: controller.signal,
      killGraceMs: 1,
    });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2));
    controller.abort();
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(-32, "SIGKILL"));
    second.emit("close", 0);
    expect((await canceled).error).toBe("LaTeX compile canceled.");
  });
});
