/** CodeMirror 6 editor (TypeScript / JavaScript / JSON) with optional diagnostics. */
import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const forgeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: '#ff9f5a' },
  { tag: [t.string, t.special(t.string)], color: '#9ad97e' },
  { tag: [t.number, t.bool, t.null], color: '#f7c661' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#6c7a8c', fontStyle: 'italic' },
  { tag: [t.typeName, t.className], color: '#7cc7ff' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#c7a6ff' },
  { tag: [t.propertyName], color: '#d7e2ee' },
  { tag: [t.definition(t.variableName)], color: '#ffffff' },
  { tag: [t.punctuation, t.bracket], color: '#93a3b5' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--code-bg)', color: '#d7e2ee', fontSize: '12.5px' },
  '.cm-content': { fontFamily: 'var(--mono)', caretColor: '#ffb067' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: '#4f5e70', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,.035)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(240,138,36,.25) !important' },
  '.cm-scroller': { overflow: 'auto' },
}, { dark: true });

export function CodeEditor({ value, onChange, language = 'ts', readOnly, check, ariaLabel }: {
  value: string; onChange?: (v: string) => void; language?: 'ts' | 'tsx' | 'js' | 'json'; readOnly?: boolean;
  check?: (text: string) => Diagnostic[]; ariaLabel?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const ro = useRef(new Compartment());
  const cb = useRef(onChange); cb.current = onChange;
  const chk = useRef(check); chk.current = check;

  useEffect(() => {
    const lang = language === 'json' ? json() : javascript({ typescript: language !== 'js', jsx: language === 'tsx' });
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), foldGutter(), history(), drawSelection(), indentOnInput(), bracketMatching(),
          highlightActiveLine(), highlightSelectionMatches(), syntaxHighlighting(forgeHighlight), lang, theme, lintGutter(),
          linter((ev) => chk.current?.(ev.state.doc.toString()) ?? [], { delay: 400 }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          ro.current.of([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current?.(u.state.doc.toString()); }),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel || 'Code' }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);

  return <div className="code-editor" ref={host} />;
}

export type { Diagnostic };
