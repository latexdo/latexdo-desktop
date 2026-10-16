declare module "bibtex-parse" {
  interface BibtexEntry {
    key?: string;
    type?: string;
    [field: string]: unknown;
  }

  interface BibtexParseOptions {
    number?: "auto" | "number" | "bigint" | "string";
  }

  interface BibtexParseApi {
    entries(input: string, options?: BibtexParseOptions): BibtexEntry[];
    parse(input: string, options?: BibtexParseOptions): unknown[];
  }

  const bibtexParse: BibtexParseApi;
  export default bibtexParse;
}
