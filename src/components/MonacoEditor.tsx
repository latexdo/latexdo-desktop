import Editor, { DiffEditor, loader } from "@monaco-editor/react";
import type { DiffEditorProps, EditorProps } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useLayoutEffect, useRef } from "react";

loader.config({ monaco });

export function MonacoEditor(props: EditorProps) {
  return <Editor {...props} />;
}

export function MonacoDiffEditor(props: DiffEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  useLayoutEffect(
    () => () => {
      const editor = editorRef.current;
      editorRef.current = null;
      if (!editor) return;
      const models = editor.getModel();
      // @monaco-editor/react disposes the models before the diff widget in its
      // passive cleanup. Detach first, during layout cleanup, so Monaco never
      // observes a disposed model still attached to a live diff widget.
      editor.setModel(null);
      if (!propsRef.current.keepCurrentOriginalModel) models?.original.dispose();
      if (
        !propsRef.current.keepCurrentModifiedModel &&
        models?.modified !== models?.original
      ) {
        models?.modified.dispose();
      }
    },
    [],
  );
  return (
    <DiffEditor
      {...props}
      onMount={(editor, instance) => {
        editorRef.current = editor;
        propsRef.current.onMount?.(editor, instance);
      }}
    />
  );
}
