"use client";

import { useMemo, useRef } from "react";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function CodeEditor({ value, onChange }: CodeEditorProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const lineNumbers = useMemo(() => Array.from({ length: value.split("\n").length }, (_, index) => index + 1), [value]);

  return (
    <div className="code-editor">
      <div className="line-numbers" aria-hidden="true">
        {lineNumbers.map((line) => <span key={line}>{line}</span>)}
      </div>
      <textarea
        ref={textarea}
        aria-label="OpenSCAD model source"
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          const gutter = event.currentTarget.previousElementSibling as HTMLElement | null;
          if (gutter) gutter.scrollTop = event.currentTarget.scrollTop;
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          event.preventDefault();
          const target = event.currentTarget;
          const start = target.selectionStart;
          const end = target.selectionEnd;
          const next = `${value.slice(0, start)}  ${value.slice(end)}`;
          onChange(next);
          requestAnimationFrame(() => {
            target.selectionStart = target.selectionEnd = start + 2;
          });
        }}
      />
    </div>
  );
}
