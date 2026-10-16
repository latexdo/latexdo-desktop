import Editor, { DiffEditor, loader } from "@monaco-editor/react";
import type { DiffEditorProps, EditorProps } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

loader.config({ monaco });

export function MonacoEditor(props: EditorProps) {
  return <Editor {...props} />;
}

export function MonacoDiffEditor(props: DiffEditorProps) {
  return <DiffEditor {...props} />;
}
