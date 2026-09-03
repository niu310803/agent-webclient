import React from "react";
import { Button, Dropdown, Input, Space } from "antd";
import type * as MonacoTypes from "monaco-editor";
import { CodeEditor } from "@/shared/ui/CodeEditor";
import { MaterialIcon } from "@/shared/ui/MaterialIcon";
import { t } from "@/shared/i18n";
import type { DocumentContentKind } from "@/shared/types/document";
import {
  hasDesktopHostBridge,
  postDesktopHostMessage,
} from "@/shared/data/desktop/desktopHostBridge";

const MarkdownPreview: React.FC<{
  content: string;
  chatId: string;
  teamChat: boolean;
}> = process.env.NODE_ENV === "test"
  ? ({ content }) => <div>{content}</div>
  : React.lazy(async () => {
      const module = await import("@/shared/ui/MarkdownContent");
      return { default: module.MarkdownContent };
    });

export type MarkdownViewMode = "source" | "preview" | "split";

type TextAnnotation = {
  id: string;
  revision: string;
  range: MonacoTypes.IRange;
  selectedText: string;
  selectedTextHash: string;
  note: string;
  invalid: boolean;
};

function hashSelectedText(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function fileExtension(name: string): string {
  const clean = name.split(/[?#]/u, 1)[0].toLowerCase();
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1) : "";
}

export function documentEditorLanguage(
  kind: DocumentContentKind,
  name: string,
): string {
  if (kind === "document-markdown") return "markdown";
  if (kind === "document-html") return "html";
  if (kind === "document-text") return "plaintext";
  const extension = fileExtension(name);
  const aliases: Record<string, string> = {
    h: "c", cc: "cpp", jsx: "javascript", mjs: "javascript", py: "python",
    rb: "ruby", rs: "rust", sh: "shell", tsx: "typescript", yml: "yaml",
  };
  return aliases[extension] || extension || "plaintext";
}

export const DocumentTextEditor: React.FC<{
  value: string;
  name: string;
  kind: DocumentContentKind;
  chatId: string;
  teamChat: boolean;
  disabled?: boolean;
  saving?: boolean;
  dirty?: boolean;
  canSave?: boolean;
  canOverwriteArtifact?: boolean;
  revision: string;
  onAnnotationCountChange?: (count: number) => void;
  onChange: (value: string) => void;
  onReload: () => void;
  onSave: (mode: "overwrite" | "new-artifact") => void;
}> = ({
  value,
  name,
  kind,
  chatId,
  teamChat,
  disabled = false,
  saving = false,
  dirty = false,
  canSave = false,
  canOverwriteArtifact = false,
  revision,
  onAnnotationCountChange,
  onChange,
  onReload,
  onSave,
}) => {
  const markdown = kind === "document-markdown";
  const previewable = markdown || kind === "document-html";
  const [mode, setMode] = React.useState<MarkdownViewMode>(
    previewable ? "split" : "source",
  );
  const editorRef = React.useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = React.useRef<MonacoTypes.editor.IEditorDecorationsCollection | null>(null);
  const [selection, setSelection] = React.useState<MonacoTypes.Selection | null>(null);
  const [annotations, setAnnotations] = React.useState<TextAnnotation[]>([]);
  React.useEffect(() => {
    setMode(previewable ? "split" : "source");
  }, [kind, name, previewable]);

  React.useEffect(() => {
    setAnnotations((current) => current.map((annotation) => ({
      ...annotation,
      invalid: annotation.revision !== revision,
    })));
  }, [revision]);

  React.useEffect(() => {
    onAnnotationCountChange?.(annotations.filter((annotation) => !annotation.invalid).length);
  }, [annotations, onAnnotationCountChange]);

  React.useEffect(() => {
    const decorations = decorationsRef.current;
    if (!decorations) return;
    decorations.set(annotations.map((annotation) => ({
      range: annotation.range,
      options: {
        className: annotation.invalid
          ? "document-annotation-invalid"
          : "document-annotation-range",
        stickiness: 1,
      },
    })));
  }, [annotations]);

  const mountEditor = React.useCallback((editor: MonacoTypes.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    decorationsRef.current = editor.createDecorationsCollection();
    const selectionSubscription = editor.onDidChangeCursorSelection((event) => {
      setSelection(event.selection.isEmpty() ? null : event.selection);
    });
    const contentSubscription = editor.onDidChangeModelContent(() => {
      const ranges = decorationsRef.current?.getRanges() || [];
      if (ranges.length === 0) return;
      setAnnotations((current) => current.map((annotation, index) => ({
        ...annotation,
        ...(ranges[index] ? { range: ranges[index] } : { invalid: true }),
      })));
    });
    editor.onDidDispose(() => {
      selectionSubscription.dispose();
      contentSubscription.dispose();
      decorationsRef.current = null;
      editorRef.current = null;
    });
  }, []);

  const addAnnotation = () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !selection || selection.isEmpty()) return;
    const selectedText = model.getValueInRange(selection).slice(0, 4_000);
    if (!selectedText) return;
    setAnnotations((current) => [...current, {
      id: globalThis.crypto.randomUUID(),
      revision,
      range: selection,
      selectedText,
      selectedTextHash: hashSelectedText(selectedText),
      note: "",
      invalid: false,
    }]);
  };

  const handoffAnnotations = () => {
    const valid = annotations.filter((annotation) => !annotation.invalid && annotation.note.trim());
    if (valid.length === 0) return;
    const text = [
      `${t("contentViewer.annotation.request")} ${name} (revision: ${revision})`,
      "",
      ...valid.map((annotation, index) =>
        `${index + 1}. L${annotation.range.startLineNumber}:C${annotation.range.startColumn}` +
        `–L${annotation.range.endLineNumber}:C${annotation.range.endColumn}` +
        ` [selectedTextHash:${annotation.selectedTextHash}]\n` +
        `   ${annotation.note.trim()}\n` +
        `   > ${annotation.selectedText.replace(/\s+/gu, " ").slice(0, 240)}`),
    ].join("\n");
    if (hasDesktopHostBridge()) {
      postDesktopHostMessage({
        type: "desktop:agent-webclient:document-handoff",
        requestId: `document_handoff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text,
      });
    } else {
      window.dispatchEvent(new CustomEvent("agent:set-composer-draft", { detail: { draft: text } }));
      window.dispatchEvent(new CustomEvent("agent:focus-composer"));
    }
    setAnnotations([]);
  };

  const preview = markdown ? (
    <React.Suspense fallback={null}>
      <MarkdownPreview content={value} chatId={chatId} teamChat={teamChat} />
    </React.Suspense>
  ) : (
    <iframe
      className="tw:h-full tw:min-h-[420px] tw:w-full tw:border-0"
      srcDoc={value}
      title={name}
      sandbox="allow-forms allow-modals allow-scripts"
    />
  );

  const editor = (
    <div className="tw:min-h-0 tw:flex-1 tw:overflow-hidden">
      <CodeEditor
        value={value}
        language={documentEditorLanguage(kind, name)}
        path={name}
        disabled={disabled || saving}
        onChange={onChange}
        onMount={mountEditor}
        options={{ lineNumbers: "on", wordWrap: "on" }}
      />
    </div>
  );

  return (
    <div className="tw:flex tw:min-h-[420px] tw:flex-1 tw:flex-col tw:overflow-hidden">
      <div className="tw:flex tw:items-center tw:justify-between tw:border-b tw:border-line-soft tw:px-2 tw:py-1.5">
        <Space size={4}>
          {previewable ? (["source", "preview", "split"] as const).map((item) => (
            <Button
              key={item}
              size="small"
              type={mode === item ? "primary" : "text"}
              onClick={() => setMode(item)}
            >
              {t(`contentViewer.markdown.${item}`)}
            </Button>
          )) : null}
          <Button size="small" disabled={!selection} onClick={addAnnotation}>
            {t("contentViewer.annotation.add")}
          </Button>
        </Space>
        <Space size={6}>
          {canOverwriteArtifact ? (
            <Button
              size="small"
              disabled={!dirty || saving}
              onClick={() => onSave("overwrite")}
            >
              {t("contentViewer.action.overwrite")}
            </Button>
          ) : null}
          {canSave ? (
            <Button
              size="small"
              type="primary"
              loading={saving}
              disabled={!dirty || saving}
              onClick={() => onSave(canOverwriteArtifact ? "new-artifact" : "overwrite")}
            >
              {canOverwriteArtifact
                ? t("contentViewer.action.saveNewArtifact")
                : t("contentViewer.action.save")}
            </Button>
          ) : null}
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [{
                key: "reload",
                label: t("contentViewer.action.reload"),
                disabled: saving,
                onClick: onReload,
              }],
            }}
          >
            <Button
              size="small"
              type="text"
              icon={<MaterialIcon name="more_horiz" />}
              aria-label={t("contentViewer.action.more")}
              title={t("contentViewer.action.more")}
            />
          </Dropdown>
        </Space>
      </div>
      {mode === "source" ? editor : null}
      {mode === "preview" ? (
        <div className="tw:min-h-0 tw:flex-1 tw:overflow-auto tw:p-4">
          {preview}
        </div>
      ) : null}
      {mode === "split" ? (
        <div className="tw:grid tw:min-h-0 tw:flex-1 tw:grid-cols-2">
          {editor}
          <div className="tw:min-h-0 tw:overflow-auto tw:border-l tw:border-line-soft tw:p-4">
            {preview}
          </div>
        </div>
      ) : null}
      {annotations.length ? (
        <div className="tw:max-h-52 tw:overflow-auto tw:border-t tw:border-line-soft tw:p-2">
          {annotations.map((annotation, index) => (
            <div key={annotation.id} className="tw:mb-2 tw:grid tw:grid-cols-[auto_1fr_auto] tw:items-center tw:gap-2">
              <code className={annotation.invalid ? "tw:text-danger" : ""}>
                L{annotation.range.startLineNumber}:C{annotation.range.startColumn}
              </code>
              <Input
                value={annotation.note}
                disabled={annotation.invalid}
                placeholder={annotation.invalid
                  ? t("contentViewer.annotation.invalid")
                  : `${index + 1}. ${annotation.selectedText.slice(0, 100)}`}
                onChange={(event) => setAnnotations((current) => current.map((item) =>
                  item.id === annotation.id ? { ...item, note: event.target.value } : item))}
              />
              <Button danger size="small" onClick={() => setAnnotations((current) => current.filter((item) => item.id !== annotation.id))}>
                {t("contentViewer.annotation.remove")}
              </Button>
            </div>
          ))}
          <Button
            type="primary"
            size="small"
            disabled={!annotations.some((annotation) => !annotation.invalid && annotation.note.trim())}
            onClick={handoffAnnotations}
          >
            {t("contentViewer.annotation.handoff")}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
