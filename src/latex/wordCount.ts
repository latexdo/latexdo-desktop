/** Source-based prose counts. This is deliberately not a TeX macro interpreter. */
export interface LatexWordSection {
  id: string;
  kind: string;
  title: string;
  level: number;
  line: number;
  column: number;
  start: number;
  end: number;
  words: number;
}
export interface LatexWordCount {
  total: number;
  abstract: number;
  sections: LatexWordSection[];
}
const levels: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};
const skippedEnvironments =
  /^(?:equation\*?|align\*?|alignat\*?|gather\*?|multline\*?|eqnarray\*?|displaymath|math|verbatim\*?|Verbatim|lstlisting|minted|comment|tikzpicture|asy|thebibliography|filecontents\*?)$/;
const ignoredArguments: Record<string, number> = {
  label: 1,
  ref: 1,
  eqref: 1,
  pageref: 1,
  autoref: 1,
  cref: 1,
  Cref: 1,
  vref: 1,
  url: 1,
  path: 1,
  includegraphics: 1,
  input: 1,
  include: 1,
  includeonly: 1,
  bibliography: 1,
  bibliographystyle: 1,
  addbibresource: 1,
  documentclass: 1,
  usepackage: 1,
  RequirePackage: 1,
  index: 1,
  glossary: 1,
  color: 1,
  setlength: 2,
  addtolength: 2,
  setcounter: 2,
  addtocounter: 2,
  definecolor: 3,
  newcommand: 2,
  renewcommand: 2,
  providecommand: 2,
  DeclareRobustCommand: 2,
  newenvironment: 3,
  renewenvironment: 3,
  hspace: 1,
  vspace: 1,
  rule: 2,
  fontsize: 2,
  printbibliography: 0,
  hypersetup: 1,
  graphicspath: 1,
  lstinputlisting: 1,
  pagestyle: 1,
  thispagestyle: 1,
};

export function countLatexWords(source: string): LatexWordCount {
  // Keep offsets and line numbers intact when removing comments.
  const text = source.replace(/(^|[^\\])(?:\\\\)*%[^\n]*/gm, (match) => {
    const percent = match.indexOf("%");
    return match.slice(0, percent) + " ".repeat(match.length - percent);
  });
  let plain: string[] = [];
  let origins: number[] = [];
  let sections: LatexWordSection[] = [];
  const emit = (value: string, offset: number) => {
    for (let i = 0; i < value.length; i++) {
      plain.push(value[i]);
      origins.push(offset + i);
    }
  };
  const space = (offset: number) => emit(" ", offset);
  const whitespace = (at: number, end: number) => {
    while (at < end && /\s/.test(text[at])) at++;
    return at;
  };
  const group = (at: number, end: number, open = "{", close = "}") => {
    at = whitespace(at, end);
    if (text[at] !== open) return null;
    let depth = 1;
    for (let i = at + 1; i < end; i++) {
      if (text[i] === "\\") {
        i++;
        continue;
      }
      if (text[i] === open) depth++;
      if (text[i] === close && --depth === 0)
        return { start: at + 1, end: i, next: i + 1 };
    }
    return { start: at + 1, end, next: end };
  };
  const optional = (at: number, end: number) => {
    let arg;
    while ((arg = group(at, end, "[", "]"))) at = arg.next;
    return at;
  };
  const record = (kind: string, start: number, end: number, title = "") => {
    const before = text.slice(0, start);
    const section: LatexWordSection = {
      id: `${kind}:${start}`,
      kind,
      title,
      level: levels[kind] ?? 2,
      start,
      end,
      line: before.split("\n").length,
      column: start - before.lastIndexOf("\n"),
      words: 0,
    };
    sections.push(section);
    return section;
  };
  const walk = (start: number, end: number, depth = 0) => {
    if (depth > 50) return; // Malformed input must not exhaust the stack while typing.
    for (let i = start; i < end; ) {
      const ch = text[i];
      if (ch === "$" || (ch === "\\" && /[([]/.test(text[i + 1] ?? ""))) {
        const delimiter =
          ch === "$"
            ? text[i + 1] === "$"
              ? "$$"
              : "$"
            : text[i + 1] === "("
              ? "\\)"
              : "\\]";
        const openingLength = ch === "$" ? delimiter.length : 2;
        let next = i + openingLength;
        while (next < end) {
          if (text.startsWith(delimiter, next)) break;
          if (text[next] === "\\") next++;
          next++;
        }
        space(i);
        i = Math.min(end, next + delimiter.length);
        continue;
      }
      if (ch !== "\\") {
        if (ch === "~" || ch === "&") space(i);
        else if (ch !== "{" && ch !== "}") emit(ch, i);
        i++;
        continue;
      }
      const commandStart = i;
      const command = /^[A-Za-z@]+/.exec(text.slice(i + 1))?.[0];
      if (!command) {
        const escaped = text[i + 1] ?? "";
        if (/[%'`^"~=]/.test(escaped)) {
          if (escaped === "%") space(i);
        } else if (escaped === "\\") space(i);
        else emit(escaped, i);
        i += 2;
        continue;
      }
      i += command.length + 1;
      if (text[i] === "*") i++;
      if (command === "verb") {
        const delimiter = text[i];
        const close = delimiter ? text.indexOf(delimiter, i + 1) : -1;
        space(i);
        i = close < 0 ? end : close + 1;
        continue;
      }
      if (/^(?:def|gdef|edef|xdef)$/.test(command)) {
        const body = text.indexOf("{", i);
        i = body < 0 ? end : (group(body, end)?.next ?? end);
        space(commandStart);
        continue;
      }
      i = optional(i, end);
      if (command === "begin" || command === "end") {
        const arg = group(i, end);
        if (!arg) continue;
        const environment = text.slice(arg.start, arg.end).trim();
        i = arg.next;
        if (environment === "document") {
          if (command === "end") return;
          // Some classes declare their abstract before begin{document}.
          const abstracts = sections.filter((section) => section.kind === "abstract");
          const kept = origins.map((offset) =>
            abstracts.some(
              (section) => section.start <= offset && offset < section.end,
            ),
          );
          plain = plain.filter((_, index) => kept[index]);
          origins = origins.filter((_, index) => kept[index]);
          sections = abstracts;
          space(i);
          continue;
        }
        if (
          command === "begin" &&
          (skippedEnvironments.test(environment) || environment === "abstract")
        ) {
          const escaped = environment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const endPattern = new RegExp("\\\\end\\s*\\{" + escaped + "\\}", "g");
          endPattern.lastIndex = i;
          const closing = endPattern.exec(text);
          const bodyEnd = Math.min(end, closing?.index ?? end);
          if (environment === "abstract") {
            record("abstract", commandStart, bodyEnd, "Abstract");
            walk(i, bodyEnd, depth + 1);
          }
          space(i);
          i = closing ? Math.min(end, closing.index + closing[0].length) : end;
          continue;
        }
        i = optional(i, end);
        if (
          command === "begin" &&
          /^(?:tabular\*?|tabularx|minipage|subfigure)$/.test(environment)
        ) {
          const count = /^(?:tabular\*|tabularx)$/.test(environment) ? 2 : 1;
          for (let n = 0; n < count; n++) i = group(i, end)?.next ?? i;
        }
        space(i);
        continue;
      }
      if (command in levels || command === "abstract") {
        const arg = group(i, end);
        if (arg) {
          space(commandStart);
          const section = record(
            command,
            commandStart,
            command === "abstract" ? arg.next : text.length,
          );
          const titleStart = plain.length;
          walk(arg.start, arg.end, depth + 1);
          section.title =
            command === "abstract"
              ? "Abstract"
              : plain.slice(titleStart).join("").replace(/\s+/g, " ").trim() ||
                `Untitled ${command}`;
          space(arg.end);
          i = arg.next;
        }
        continue;
      }
      if (/^(?:caption|captionof|footnote|footnotetext|marginpar)$/.test(command)) {
        if (command === "captionof") i = group(i, end)?.next ?? i;
        const arg = group(i, end);
        if (arg) {
          space(commandStart);
          walk(arg.start, arg.end, depth + 1);
          space(arg.end);
          i = arg.next;
        }
        continue;
      }
      const ignore = /^(?:[A-Za-z]*cite[A-Za-z]*|nocite)$/.test(command)
        ? 1
        : ignoredArguments[command];
      const skipFirst = /^(?:href|textcolor|colorbox|foreignlanguage)$/.test(command);
      if (ignore !== undefined || skipFirst) {
        for (let n = 0; n < (ignore ?? 1); n++) {
          i = optional(i, end);
          const arg = group(i, end);
          if (arg) i = arg.next;
          else if (text[whitespace(i, end)] === "\\") {
            const macro = /^\\[A-Za-z@]+/.exec(text.slice(whitespace(i, end)));
            if (macro) i = whitespace(i, end) + macro[0].length;
          }
        }
        space(commandStart);
        continue;
      }
      if (/^(?:LaTeX|TeX|BibTeX)$/.test(command)) emit(command, commandStart);
      // Other command names disappear, but their visible braced text remains.
    }
  };
  walk(0, text.length);
  const words = [
    ...plain
      .join("")
      .matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[-'’][\p{L}\p{M}\p{N}]+)*/gu),
  ].map((match) => origins[match.index]);
  const lowerBound = (offset: number) => {
    let low = 0,
      high = words.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (words[mid] < offset) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  sections.forEach((section, index) => {
    if (section.kind !== "abstract") {
      const next = sections
        .slice(index + 1)
        .find(
          (candidate) =>
            candidate.kind !== "abstract" && candidate.level <= section.level,
        );
      section.end = next?.start ?? text.length;
    }
    section.words = lowerBound(section.end) - lowerBound(section.start);
  });
  return {
    total: words.length,
    abstract: sections
      .filter((section) => section.kind === "abstract")
      .reduce((sum, section) => sum + section.words, 0),
    sections,
  };
}
