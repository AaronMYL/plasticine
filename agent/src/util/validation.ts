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

