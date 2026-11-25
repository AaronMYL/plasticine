import type {
  AdoptRuleRequest,
  DeleteSpaceRequest,
  RestoreSpaceRequest,
  ReviewSummary,
  RunSubscriptionRequest,
  RunSubscriptionResponse,
  SaveSpaceRequest,
  SpaceListResponse,
  LibraryTrashResponse,
  SpaceView,
  SpaceVersionsResponse,
  SubscriptionListResponse,
  SubscriptionView,
  UndoSpaceRequest,
  UpdateSubscriptionRequest,
} from './shared.ts';

export interface SpaceListFilter {
  standalone?: boolean;
}

export interface LibraryApi {
  batch(input: import('./shared.ts').LibraryBatchRequest): Promise<import('./shared.ts').BatchResponse>;
  emptyTrash(input: import('./shared.ts').EmptyTrashRequest): Promise<import('./shared.ts').BatchResponse>;
  trash(signal?: AbortSignal): Promise<LibraryTrashResponse>;
}

export interface SpacesApi {
  list(signal?: AbortSignal, filter?: SpaceListFilter): Promise<SpaceListResponse>;
  get(id: string, signal?: AbortSignal): Promise<SpaceView>;
  versions(id: string, version?: number, signal?: AbortSignal): Promise<SpaceVersionsResponse>;
  save(id: string, input: SaveSpaceRequest): Promise<SpaceView>;
  undo(id: string, input: UndoSpaceRequest): Promise<SpaceView>;
  remove(id: string, input: DeleteSpaceRequest): Promise<void>;
  restore(id: string, input: RestoreSpaceRequest): Promise<SpaceView>;
  asset(path: string, signal?: AbortSignal): Promise<Blob>;
  importFiles(input: import('./shared.ts').ImportSpacesRequest): Promise<import('./shared.ts').ImportSpacesResponse>;
  exportFiles(ids: readonly string[], format: 'markdown' | 'docx', signal?: AbortSignal)
    : Promise<import('./client.ts').DownloadedFile>;
  render(input: import('./shared.ts').RenderPageRequest, signal?: AbortSignal)
    : Promise<import('./client.ts').DownloadedFile>;
}

export interface SubscriptionsApi {
  list(signal?: AbortSignal): Promise<SubscriptionListResponse>;
  get(id: string, signal?: AbortSignal): Promise<SubscriptionView>;
  update(id: string, input: UpdateSubscriptionRequest): Promise<SubscriptionView>;
  adoptRule(id: string, input: AdoptRuleRequest): Promise<SubscriptionView>;
  run(id: string, input: RunSubscriptionRequest): Promise<RunSubscriptionResponse>;
  review(signal?: AbortSignal): Promise<ReviewSummary>;
}
