import type {
  AddMemoryLineRequest, ApplyCleanupRequest, ApplyCleanupResponse, ChooseDreamChangeRequest, EditMemoryLineRequest,
  LatestCleanupResponse, LayersMoveResponse, MemoryDreamChangeView, MemoryDreamView, MemoryGrantsResponse,
  MemoryLineSection,
  MemorySearchResponse, MemoryTopicDoc, MemoryTopicListResponse, MoveMemoryLineRequest, RetireMemoryLineRequest,
  RevokeLoopGrantRequest, StartCleanupRequest, UndoDreamChangeRequest, UndoLayersMoveRequest,
} from './shared.ts';

export interface WithdrawnLine {
  id: string;
  text: string;
  section: MemoryLineSection;
  retiredAt: string;
}

export interface MemoryTopicsApi {
  list(signal?: AbortSignal): Promise<MemoryTopicListResponse>;
  get(id: string, signal?: AbortSignal): Promise<MemoryTopicDoc>;
  search(q: string, archive: boolean, signal?: AbortSignal): Promise<MemorySearchResponse>;
  dream(signal?: AbortSignal): Promise<MemoryDreamView>;
  /** POST /v2/memory/dreams/changes/:id/undo */
  undoDream(id: string, input: UndoDreamChangeRequest): Promise<MemoryDreamChangeView>;
  /** POST /v2/memory/dreams/changes/:id/choose */
  chooseDream(id: string, input: ChooseDreamChangeRequest): Promise<MemoryDreamChangeView>;
  /** POST /v2/memory/docs/:docId/lines */
  addLine(docId: string, input: AddMemoryLineRequest): Promise<void>;
  /** PUT /v2/memory/docs/:docId/lines/:lineId */
  editLine(docId: string, lineId: string, input: EditMemoryLineRequest): Promise<void>;
  /** POST /v2/memory/docs/:docId/lines/:lineId/retire */
  retireLine(docId: string, lineId: string, input: RetireMemoryLineRequest): Promise<void>;
  /** POST /v2/memory/docs/:docId/lines/:lineId/move */
  moveLine(docId: string, lineId: string, input: MoveMemoryLineRequest): Promise<void>;
  withdrawn(docId: string, signal?: AbortSignal): Promise<WithdrawnLine[]>;
  grants(signal?: AbortSignal): Promise<MemoryGrantsResponse>;
  revokeLoopGrant(input: RevokeLoopGrantRequest): Promise<MemoryGrantsResponse>;
  layersMove(signal?: AbortSignal): Promise<LayersMoveResponse>;
  undoLayersMove(input: UndoLayersMoveRequest): Promise<LayersMoveResponse>;
  /** GET /v2/memory/cleanups/latest */
  cleanup(signal?: AbortSignal): Promise<LatestCleanupResponse>;
  /** POST /v2/memory/cleanups */
  startCleanup(input: StartCleanupRequest): Promise<void>;
  /** POST /v2/memory/cleanups/:id/apply */
  applyCleanup(id: string, input: ApplyCleanupRequest): Promise<ApplyCleanupResponse>;
}

export interface ThingsApi {
  memoryTopics: MemoryTopicsApi;
}
