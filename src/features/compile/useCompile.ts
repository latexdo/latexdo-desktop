import { useState } from "react";
import type { CompileResult, Diagnostic } from "../../types";

export function useCompile() {
  const [pdfComplianceDiagnostics, setPdfComplianceDiagnostics] = useState<
    Diagnostic[]
  >([]);
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [compileJobCount, setCompileJobCount] = useState(0);
  const [compileProgress, setCompileProgress] = useState(0);

  return {
    pdfComplianceDiagnostics,
    setPdfComplianceDiagnostics,
    compileResult,
    setCompileResult,
    compileJobCount,
    setCompileJobCount,
    compileProgress,
    setCompileProgress,
    compiling: compileJobCount > 0,
  };
}
