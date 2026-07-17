"use client";

import type { CompletionContext } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { openScadCompletionSource, openScadLanguage } from "@/lib/scad/editor-language";

export interface CursorLocation {
  line: number;
  column: number;
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (location: CursorLocation) => void;
  projectSources?: readonly string[];
  projectFiles?: readonly string[];
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "#171a17",
    color: "#d7ddd6",
    fontSize: "11.5px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "20px",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "13px 16px 30px 14px",
    caretColor: "var(--accent)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
  ".cm-gutters": {
    minWidth: "43px",
    paddingTop: "13px",
    backgroundColor: "#151815",
    color: "#555d54",
    borderRight: "1px solid #252a25",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "42px",
    height: "20px",
    padding: "0 11px 0 8px",
    fontSize: "11px",
    lineHeight: "20px",
  },
  ".cm-activeLine": { backgroundColor: "#1b201b" },
  ".cm-activeLineGutter": { backgroundColor: "#1b201b", color: "#8b968a" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "#31554b !important",
  },
  ".cm-selectionMatch": { backgroundColor: "#29443c" },
  ".cm-matchingBracket": {
    color: "#effffb",
    backgroundColor: "#31554b",
    outline: "1px solid #4e8073",
  },
  ".cm-nonmatchingBracket": { color: "#ff7b72" },
  ".cm-foldGutter .cm-gutterElement": { color: "#59645b" },
  ".cm-foldPlaceholder": {
    color: "#8b968a",
    backgroundColor: "#242a24",
    border: "1px solid #343d35",
  },
  ".cm-tooltip": {
    color: "#d7ddd6",
    backgroundColor: "#202520",
    border: "1px solid #394039",
    borderRadius: "5px",
    boxShadow: "0 10px 28px #0008",
  },
  ".cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
  },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 8px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    color: "#effffb",
    backgroundColor: "#31554b",
  },
  ".cm-completionDetail": { color: "#89958b", fontStyle: "normal" },
  ".cm-panels": { color: "#d7ddd6", backgroundColor: "#151815" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid #303630" },
  ".cm-search": { padding: "6px 8px" },
  ".cm-textfield": {
    color: "#d7ddd6",
    backgroundColor: "#202520",
    border: "1px solid #394039",
    borderRadius: "3px",
  },
  ".cm-button": {
    color: "#d7ddd6",
    backgroundImage: "none",
    backgroundColor: "#292f29",
    border: "1px solid #414941",
  },
}, { dark: true });

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#c792ea" },
  { tag: [tags.bool, tags.null], color: "#ffcb6b" },
  { tag: tags.number, color: "#f78c6c" },
  { tag: tags.string, color: "#c3e88d" },
  { tag: [tags.lineComment, tags.blockComment], color: "#63766a", fontStyle: "italic" },
  { tag: tags.operator, color: "#89ddff" },
  { tag: tags.punctuation, color: "#91a098" },
  { tag: tags.definition(tags.variableName), color: "#82aaff" },
  { tag: tags.function(tags.variableName), color: "#d7b7ff" },
  { tag: tags.standard(tags.variableName), color: "#5bd6c3" },
  { tag: tags.special(tags.variableName), color: "#ff9cac" },
  { tag: tags.constant(tags.variableName), color: "#ffcb6b" },
  { tag: tags.variableName, color: "#d7ddd6" },
]);

export function CodeEditor({
  value,
  onChange,
  onCursorChange,
  projectSources = [],
  projectFiles = [],
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const projectSourcesRef = useRef(projectSources);
  const projectFilesRef = useRef(projectFiles);
  const createStateRef = useRef<((doc: string) => EditorState) | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
    onCursorChangeRef.current = onCursorChange;
    projectSourcesRef.current = projectSources;
    projectFilesRef.current = projectFiles;
  }, [onChange, onCursorChange, projectSources, projectFiles]);

  useEffect(() => {
    if (!host.current) return;

    const completionSource = (context: CompletionContext) => openScadCompletionSource(context, {
      sources: projectSourcesRef.current,
      files: projectFilesRef.current,
    });
    const createState = (doc: string) => EditorState.create({
      doc,
      extensions: [
        basicSetup,
        openScadLanguage,
        openScadLanguage.data.of({ autocomplete: completionSource }),
        EditorState.tabSize.of(2),
        indentUnit.of("  "),
        keymap.of([indentWithTab]),
        editorTheme,
        syntaxHighlighting(highlightStyle),
        EditorView.contentAttributes.of({
          "aria-label": "OpenSCAD model source",
          "aria-multiline": "true",
          autocapitalize: "off",
          autocorrect: "off",
          spellcheck: "false",
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          if (update.docChanged || update.selectionSet) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            onCursorChangeRef.current?.({ line: line.number, column: head - line.from + 1 });
          }
        }),
      ],
    });
    createStateRef.current = createState;
    const editor = new EditorView({ parent: host.current, state: createState(value) });
    view.current = editor;
    onCursorChangeRef.current?.({ line: 1, column: 1 });

    return () => {
      editor.destroy();
      view.current = null;
      createStateRef.current = null;
    };
    // The editor owns its document after mount; refs keep callbacks and completion data current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = view.current;
    const createState = createStateRef.current;
    if (!editor || !createState || editor.state.doc.toString() === value) return;
    // A new file/example starts a fresh editing session so undo cannot cross document boundaries.
    editor.setState(createState(value));
    editor.dispatch({ effects: EditorView.scrollIntoView(0, { x: "start", y: "start" }) });
    onCursorChangeRef.current?.({ line: 1, column: 1 });
  }, [value]);

  return <div className="code-editor" ref={host} />;
}
