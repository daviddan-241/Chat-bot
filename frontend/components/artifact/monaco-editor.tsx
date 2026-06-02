"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/spinner";

const Editor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="h-full grid place-items-center text-ink-faint">
      <Spinner />
    </div>
  ),
});

interface Props {
  value: string;
  language: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
}

export function MonacoEditor({ value, language, onChange, readOnly }: Props) {
  return (
    <div className="h-full w-full bg-[#0c1220]">
      <Editor
        height="100%"
        language={language}
        value={value}
        theme="nova-dark"
        onMount={(_editor, monaco) => {
          monaco.editor.defineTheme("nova-dark", {
            base: "vs-dark",
            inherit: true,
            rules: [],
            colors: {
              "editor.background": "#0c1220",
              "editor.lineHighlightBackground": "#11192c",
              "editorLineNumber.foreground": "#3a4358",
              "editorLineNumber.activeForeground": "#9aa3b8",
              "editor.selectionBackground": "#2a3550",
              "editorIndentGuide.background": "#1b2438",
              "editorIndentGuide.activeBackground": "#2a3550",
              "scrollbarSlider.background": "#1f273d",
              "scrollbarSlider.hoverBackground": "#2a3550",
              "scrollbarSlider.activeBackground": "#384a73",
              "editorWidget.background": "#0f1626",
              "editorWidget.border": "#1b2438",
            },
          });
          monaco.editor.setTheme("nova-dark");
        }}
        onChange={(v) => onChange?.(v ?? "")}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontLigatures: true,
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          padding: { top: 12, bottom: 12 },
          renderLineHighlight: "all",
          scrollBeyondLastLine: false,
          tabSize: 2,
          wordWrap: "on",
          automaticLayout: true,
          readOnly,
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        }}
      />
    </div>
  );
}
