// artifacts/: 文件页的工作目录（状态目录里的 files/）。文件只在 files/ 和 files-trash/ 里动，路径不出状态目录。
// 2026-11-05 他定：成果页删掉，成果迁进笔记里「Plasticine 写的」文件夹（迁移 0059）；成果的登记、版本、核实一起删了。

import { Workspace } from './workspace.ts';

export { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.ts';
export type { ArtifactErrorCode } from './errors.ts';
export { checkUpload, contentTypeOf, FILE_TYPES, INLINE_TYPES } from './file-types.ts';
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
