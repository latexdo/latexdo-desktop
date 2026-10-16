export type CitationEntry = {
  key: string;
  type: string;
  title?: string;
  author?: string;
  editor?: string;
  year?: string;
  journal?: string;
  booktitle?: string;
  publisher?: string;
  school?: string;
  institution?: string;
  doi?: string;
  url?: string;
  eprint?: string;
  archivePrefix?: string;
  howpublished?: string;
  abstract?: string;
  keywords?: string;
  note?: string;
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
  citedKeys: string[];
  labels: LabelEntry[];
};
