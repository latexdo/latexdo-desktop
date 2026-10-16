import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  Download,
  FileText,
  ImageUp,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react";
import { convertDrawioToTikz, type DrawioToTikzConversion } from "../drawioToTikz";
import { tikzFromTrace, traceImage, traceSummary } from "../features/tikz/imageToTikz";

interface FigureToTikzConverterProps {
  onInsertCode?: (code: string) => void;
}

type ConverterSource =
  | {
      kind: "image";
      name: string;
      image: HTMLImageElement;
    }
  | {
      kind: "drawio";
      name: string;
      conversion: DrawioToTikzConversion;
    };

function isDrawioFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".drawio") ||
    name.endsWith(".mxfile") ||
    name.endsWith(".xml") ||
    file.type === "application/xml" ||
    file.type === "text/xml"
  );
}

function conversionSummary(conversion: DrawioToTikzConversion): string {
  const shapeLabel = conversion.shapeCount === 1 ? "shape" : "shapes";
  const connectorLabel = conversion.connectorCount === 1 ? "connector" : "connectors";
  const labelLabel = conversion.labelCount === 1 ? "label" : "labels";
  return `Converted ${conversion.shapeCount} ${shapeLabel}, ${conversion.connectorCount} ${connectorLabel}, and ${conversion.labelCount} ${labelLabel}.`;
}

export function FigureToTikzConverter({ onInsertCode }: FigureToTikzConverterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ConverterSource | null>(null);
  const [tikzCode, setTikzCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [conversionError, setConversionError] = useState("");
  const [traceNote, setTraceNote] = useState("");
  const image = source?.kind === "image" ? source.image : null;
  const nameRef = useRef("image.png");
  nameRef.current = source?.name ?? "image.png";

  const detectShapes = useCallback((img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const maxW = 800;
    const maxH = 600;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(img, 0, 0, w, h);

    setAnalyzing(true);

    setTimeout(() => {
      const trace = traceImage(ctx.getImageData(0, 0, w, h).data, w, h);
      setTikzCode(tikzFromTrace(trace, w, h, nameRef.current));
      setTraceNote(traceSummary(trace));
      setAnalyzing(false);
    }, 100);
  }, []);

  useEffect(() => {
    if (source?.kind === "image") {
      detectShapes(source.image);
    }
  }, [detectShapes, source]);

  const handleDrawioText = useCallback(async (text: string, name: string) => {
    setAnalyzing(true);
    setConversionError("");
    setTikzCode("");
    try {
      const conversion = await convertDrawioToTikz(text);
      setSource({ kind: "drawio", name, conversion });
      setTikzCode(conversion.code);
    } catch (error) {
      setSource(null);
      setConversionError(
        error instanceof Error ? error.message : "Could not convert draw.io file.",
      );
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      if (isDrawioFile(file)) {
        const reader = new FileReader();
        reader.onload = (e) => {
          void handleDrawioText(String(e.target?.result ?? ""), file.name);
        };
        reader.readAsText(file);
        return;
      }
      if (!file.type.startsWith("image/")) {
        setConversionError("Upload an image or draw.io XML file.");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          setSource({ kind: "image", name: file.name || "Image", image: img });
          setTikzCode("");
          setConversionError("");
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    },
    [handleDrawioText],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text.includes("<mxfile") || text.includes("<mxGraphModel")) {
        void handleDrawioText(text, "Clipboard draw.io diagram");
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) handleFile(file);
        }
      }
    },
    [handleDrawioText, handleFile],
  );

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tikzCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([tikzCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = source?.name
      ? source.name.replace(/\.(drawio|mxfile|xml|png|jpe?g|svg)$/i, ".tikz.tex")
      : "tikz-figure.tex";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReanalyze = () => {
    if (image) detectShapes(image);
  };

  const resetSource = () => {
    setSource(null);
    setTikzCode("");
    setConversionError("");
    setTraceNote("");
  };

  return (
    <div className="tikz-converter-root">
      <div className="tikz-converter-header">
        <span className="tikz-converter-title">
          <ImageUp size={16} />
          <span>Figure → TikZ Converter</span>
        </span>
        <div className="tikz-converter-hints">
          <span>Drop an image or draw.io file, click to upload, or paste</span>
        </div>
      </div>

      {!source ? (
        <div
          className="tikz-converter-upload"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onPaste={handlePaste}
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={40} />
          <span className="tikz-converter-upload-text">
            Drop an image or draw.io file here, click to upload, or paste
          </span>
          <span className="tikz-converter-upload-hint">
            Supports PNG, JPG, SVG, screenshots, and .drawio XML diagrams
          </span>
          {conversionError ? (
            <span className="tikz-converter-error">{conversionError}</span>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.drawio,.mxfile,.xml"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      ) : (
        <div className="tikz-converter-body">
          <div className="tikz-converter-preview">
            <div className="tikz-converter-preview-header">
              <span>
                {source.kind === "drawio" ? "draw.io Diagram" : "Original Image"}
              </span>
              <div className="tikz-converter-preview-actions">
                <button className="tikz-converter-btn" onClick={resetSource}>
                  <Upload size={13} /> Upload New
                </button>
                {source.kind === "image" ? (
                  <button
                    className="tikz-converter-btn"
                    onClick={handleReanalyze}
                    disabled={analyzing}
                  >
                    <RefreshCw size={13} /> {analyzing ? "Analyzing..." : "Re-analyze"}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="tikz-converter-canvas-wrap">
              {source.kind === "drawio" ? (
                <div className="tikz-converter-diagram-summary">
                  <FileText size={36} />
                  <span>{source.name}</span>
                  <small>{source.conversion.pageName}</small>
                  <p>{conversionSummary(source.conversion)}</p>
                </div>
              ) : (
                <canvas
                  ref={canvasRef}
                  className="tikz-converter-canvas"
                  style={{ maxWidth: "100%", maxHeight: "400px" }}
                />
              )}
            </div>
          </div>

          <div className="tikz-converter-code">
            <div className="tikz-converter-code-header">
              <span>TikZ Code</span>
              <div className="tikz-converter-code-actions">
                <button
                  className="tikz-converter-btn"
                  onClick={handleCopy}
                  disabled={!tikzCode}
                >
                  <Copy size={13} /> {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  className="tikz-converter-btn"
                  onClick={handleDownload}
                  disabled={!tikzCode}
                >
                  <Download size={13} /> Download
                </button>
                {onInsertCode && tikzCode && (
                  <button
                    className="tikz-converter-btn tikz-insert-btn"
                    onClick={() => onInsertCode(tikzCode)}
                  >
                    <Plus size={13} /> Insert
                  </button>
                )}
              </div>
            </div>
            {source.kind === "image" && traceNote && !analyzing ? (
              <p className="tikz-converter-trace-note" role="status">
                {traceNote}
              </p>
            ) : null}
            <pre className="tikz-converter-code-pre">
              <code>
                {tikzCode ||
                  (analyzing
                    ? "// Analyzing image... please wait"
                    : "// Upload an image to generate TikZ code")}
              </code>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
