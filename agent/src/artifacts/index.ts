// artifacts/: 文件页的工作目录（状态目录里的 files/）。文件只在 files/ 和 files-trash/ 里动，路径不出状态目录。
// 11-16 加 file_save / reply_files：Plasticine 存文件进文件页、把文件页里的文件发给他；file_make / file_convert：
// 生成 Word、Excel、PPT、PDF，转格式（office/ 自己写这几种文件）；image_generate / image_edit / audio_transcribe。
// 2026-11-05 他定：成果页删掉，成果迁进笔记里「Plasticine 写的」文件夹（迁移 0059）；成果的登记、版本、核实一起删了。

import { Workspace } from './workspace.ts';

export { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.ts';
export type { ArtifactErrorCode } from './errors.ts';
export { checkUpload, contentTypeOf, FILE_TYPES, INLINE_TYPES } from './file-types.ts';
export { fileTools, REPLY_FILES_MAX, saveFile } from './file-tools.ts';
export type { Downloaded, FileToolParts } from './file-tools.ts';
export { officeTools } from './office-tools.ts';
export { makeXlsx } from './office/xlsx-make.ts';
export { writeZip } from './office/zip-write.ts';
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
