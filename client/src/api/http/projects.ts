// /v2/projects 的真实现：列表、详情、新建、编辑、健康度、归档与拿出、待办。写操作都带 requestId；带 version 的过时了服务端回
// 409 和现在那一个项目，换成 ConflictError 交给界面。

import type { ProjectsApi } from '../client.ts';
import {
  PROJECTS_PATH,
  ProjectDetailSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  ProjectRowViewSchema,
  ProjectTodoResponseSchema,
  type AddProjectTodoRequest,
  type CreateProjectRequest,
  type EditProjectTodoRequest,
  type ProjectTodoResponse,
  type EditProjectRequest,
  type FileProjectItemRequest,
  type ProjectDetail,
  type ProjectListResponse,
  type ProjectQuery,
  type ProjectRowView,
  type SetProjectHealthRequest,
  type UnfileProjectItemRequest,
} from '../shared.ts';
import { conflictWith } from './conflict.ts';
import type { HttpMethod, Transport } from './transport.ts';

function projectPath(id: string): string {
  return `${PROJECTS_PATH}/${encodeURIComponent(id)}`;
}

export class HttpProjects implements ProjectsApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async list(query: ProjectQuery, signal?: AbortSignal): Promise<ProjectListResponse> {
    return this.transport.request({
      method: 'GET',
      path: PROJECTS_PATH,
      query: { tz: query.tz, includeDone: query.includeDone },
      schema: ProjectListResponseSchema,
      what: '读项目',
      lostAs: 'failed',
      signal,
    });
  }

  async get(id: string, query: ProjectQuery, signal?: AbortSignal): Promise<ProjectDetail> {
    return this.transport.request({
      method: 'GET',
      path: projectPath(id),
      query: { tz: query.tz },
      schema: ProjectDetailSchema,
      what: '读这个项目',
      lostAs: 'failed',
      signal,
    });
  }

  async create(input: CreateProjectRequest): Promise<ProjectRowView> {
    return this.write('POST', PROJECTS_PATH, input, '新建项目');
  }

  async edit(id: string, input: EditProjectRequest): Promise<ProjectRowView> {
    return this.write('PUT', projectPath(id), input, '改项目');
  }

  async setHealth(id: string, input: SetProjectHealthRequest): Promise<ProjectRowView> {
    return this.write('POST', `${projectPath(id)}/health`, input, '定健康度');
  }

  async file(id: string, input: FileProjectItemRequest): Promise<ProjectRowView> {
    return this.write('POST', `${projectPath(id)}/items`, input, '归到项目');
  }

  async unfile(id: string, input: UnfileProjectItemRequest): Promise<ProjectRowView> {
    return this.write('POST', `${projectPath(id)}/items/remove`, input, '从项目拿出');
  }

  async addTodo(id: string, input: AddProjectTodoRequest): Promise<ProjectTodoResponse> {
    return this.transport.request({ method: 'POST', path: `${projectPath(id)}/todos`, body: input,
      schema: ProjectTodoResponseSchema, what: '加一条待办', lostAs: 'uncertain' });
  }

  async editTodo(id: string, todoId: string, input: EditProjectTodoRequest): Promise<ProjectTodoResponse> {
    return this.transport.request({ method: 'PUT', path: `${projectPath(id)}/todos/${encodeURIComponent(todoId)}`,
      body: input, schema: ProjectTodoResponseSchema, what: '改这条待办', lostAs: 'uncertain' });
  }

  private async write(method: HttpMethod, path: string, body: unknown, what: string): Promise<ProjectRowView> {
    const response = await this.transport.request({
      method,
      path,
      body,
      schema: ProjectResponseSchema,
      what,
      lostAs: 'uncertain',
      refine: conflictWith(ProjectRowViewSchema),
    });
    return response.project;
  }
}
