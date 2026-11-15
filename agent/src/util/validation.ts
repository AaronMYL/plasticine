// 校验器的路径和 message 都可能引用输入；只允许 schema 声明的字段出现在公开错误中。
import type { TSchema } from 'typebox';

interface ValidationIssue {
  instancePath: string;
  params?: unknown;
}

function childSchemas(schema: TSchema, key: string): TSchema[] {
  const found: TSchema[] = [];
  const properties: unknown = 'properties' in schema ? schema.properties : undefined;
  if (typeof properties === 'object' && properties !== null && Object.hasOwn(properties, key)) {
    const child = (properties as Record<string, TSchema>)[key];
    if (child !== undefined) {
      found.push(child);
    }
  }
  if ('type' in schema && schema.type === 'array' && /^(0|[1-9]\d*)$/.test(key)
    && 'items' in schema && typeof schema.items === 'object' && schema.items !== null) {
    found.push(schema.items as TSchema);
  }
  for (const branch of ['anyOf', 'oneOf', 'allOf']) {
    const alternatives: unknown = Reflect.get(schema, branch);
    if (Array.isArray(alternatives)) {
      for (const alternative of alternatives as TSchema[]) {
        found.push(...childSchemas(alternative, key));
      }
    }
  }
  return found;
}

export function validationField(schema: TSchema, issue: ValidationIssue | undefined): string {
  if (issue === undefined) {
    return '';
  }
  const path = issue.instancePath.split('/').slice(1).map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  const safe: string[] = [];
  let schemas = [schema];
  for (const part of path) {
    const next = schemas.flatMap((candidate) => childSchemas(candidate, part));
    if (next.length === 0) {
      return safe.join('.');
    }
    safe.push(part);
    schemas = next;
  }
  const params = issue.params;
  if (typeof params === 'object' && params !== null && 'requiredProperties' in params) {
    const missing: unknown = params.requiredProperties;
    if (Array.isArray(missing)) {
      const field = missing.find((key: unknown) => typeof key === 'string'
        && schemas.some((candidate) => childSchemas(candidate, key).length > 0));
      if (typeof field === 'string') {
        safe.push(field);
      }
    }
  }
  return safe.join('.');
}

/**
 * 给模型看的一条参数错误。缺必填字段时直接说缺哪几个（第 102 条：建任务缺契约要报清楚的错）；字段名只取 schema
 * 声明过的，不回显输入。
 */
export function argumentProblem(schema: TSchema, issue: ValidationIssue & { keyword?: string }): string {
  const params = issue.params;
  if (issue.keyword === 'required' && typeof params === 'object' && params !== null
    && 'requiredProperties' in params && Array.isArray(params.requiredProperties)) {
    const parent = validationField(schema, { instancePath: issue.instancePath });
    const prefix = parent === '' ? '' : `/${parent.replaceAll('.', '/')}`;
    const names = (params.requiredProperties as unknown[]).flatMap((key) => {
      if (typeof key !== 'string') { return []; }
      const field = validationField(schema, { instancePath: issue.instancePath, params: { requiredProperties: [key] } });
      return field.split('.').at(-1) === key ? [`${prefix}/${key}`] : [];
    });
    if (names.length > 0) { return `缺少必填字段 ${names.join('、')}`; }
  }
  return `/${validationField(schema, issue).replaceAll('.', '/')} 格式不对`;
}
