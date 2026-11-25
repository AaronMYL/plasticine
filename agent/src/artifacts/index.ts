import { Workspace } from './workspace.ts';

export { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.ts';
export type { ArtifactErrorCode } from './errors.ts';
export { checkUpload, contentTypeOf, FILE_TYPES, INLINE_TYPES } from './file-types.ts';
export { fileTools, REPLY_FILES_MAX, saveFile } from './file-tools.ts';
export type { Downloaded, FileToolParts } from './file-tools.ts';
export { officeTools } from './office-tools.ts';
export { makeXlsx } from './office/xlsx-make.ts';
export { writeZip } from './office/zip-write.ts';
export { makeDocx } from './office/docx-make.ts';
export { inlineOf, markdownBlocks, plainOf } from './office/markdown-blocks.ts';
export type { Block, Inline } from './office/markdown-blocks.ts';
export { imageInfo } from './office/package-xml.ts';
export type { ImageData } from './office/package-xml.ts';
export type { ZipFile } from './office/zip-write.ts';
export type { OfficeToolParts } from './office-tools.ts';
export { ImageOpSchema, mediaTools, pathForMime } from './media-tools.ts';
export { sandboxTool } from './sandbox-tool.ts';
export type { SandboxRun, SandboxToolParts } from './sandbox-tool.ts';
export type { Drawn, FileTranscriptLike, ImageOpInput, MediaToolParts } from './media-tools.ts';
export {
  checkName,
  DOWNLOAD_MAX_BYTES,
  FILES_DIRECTORY,
  pathSegments,
  TRASH_DIRECTORY,
  UPLOAD_MAX_BYTES,
  Workspace,
} from './workspace.ts';
export type { TrashEntry, WorkspaceEntry } from './workspace.ts';

export function createArtifacts(options: { stateDirectory: string; now: () => Date }) {
  const workspace = new Workspace(options.stateDirectory, options.now);
  return { workspace };
}

export type Artifacts = ReturnType<typeof createArtifacts>;
