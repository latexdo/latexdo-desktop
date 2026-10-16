export type CitationEntry = {
  key: string;
  type: string;
  title?: string;
  author?: string;
  year?: string;
  journal?: string;
  booktitle?: string;
  publisher?: string;
  url?: string;
  raw?: string;
  sourceFile: string;
};
export type LabelEntry = {
  key: string;
  kind:
    | "figure"
    | "table"
    | "equation"
    | "section"
    | "subsection"
    | "theorem"
    | "unknown";
  caption?: string;
  title?: string;
  line: number;
  sourceFile: string;
};
export type LatexIndex = {
  citations: CitationEntry[];
  labels: LabelEntry[];
};
