// The module mocks every main-process suite installs. Each suite calls these
// from its own vi.mock factories (vi.mock only applies in the declaring file).
import { H } from "./mainHarness.js";

export const terminalMock = () => ({
  registerTerminalIpc: (...args: unknown[]) => H.registerTerminalIpc(...args),
});

export const peerCollabMock = () => ({
  registerPeerCollabIpc: () => undefined,
  disposePeerCollab: () => undefined,
  sharedProjectSourceFolder: (...args: unknown[]) => H.sharedProjectSourceFolder(...args),
});

export const buildInfoMock = () => ({ readBuildInfo: () => H.buildInfo });

export const aiIpcMock = () => ({ registerAiIpc: () => undefined });

export const voiceMock = () => ({ stopBundledSpeechServer: () => undefined });

export const compilerMock = <T extends object>(original: T) => ({
  ...original,
  compileLatex: (...args: unknown[]) => H.compile(...args),
  compileAsymptote: (...args: unknown[]) => H.asymptote(...args),
});

export const docxMock = () => ({
  importDocxIntoProject: (...args: unknown[]) => H.docxImport(...args),
});

export const pdfImportMock = () => ({
  importPdfIntoProject: (...args: unknown[]) => H.pdfImport(...args),
});

export const synctexMock = () => ({
  forwardSyncTex: (...args: unknown[]) => H.forwardSyncTex(...args),
  backwardSyncTex: (...args: unknown[]) => H.backwardSyncTex(...args),
});

export const orcidMock = <T extends object>(original: T) => ({
  ...original,
  fetchOrcidProfile: (...args: unknown[]) => H.fetchOrcidProfile(...args),
});
