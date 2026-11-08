import type { MemoryTopicDoc, ProjectDetail } from '../../api/shared.ts';
import type { Quote } from '../../api/types.ts';
import { routeHash } from '../../shell/routes.ts';
import { briefRows } from '../projects/project-brief.ts';
import { todosOf } from '../projects/project-todos.ts';

export function projectQuote(detail: ProjectDetail): Quote {
  const { project } = detail;
  const text = [project.name, routeHash({ view: 'projects', noteId: null, projectId: project.id }),
    ...todosOf(detail).map((todo) => `${todo.doneAt === null ? '待办' : '已完成'}：${todo.title}`
      + (todo.due === null ? '' : `（${todo.due}）`)),
    ...briefRows(detail.brief, detail.decisions).map((row) => `${row.label}：${row.value}`),
    ...detail.materials.filter((item) => item.kind === 'note').map((item) => `笔记：${item.title}`),
  ].join('\n');
  return { id: `quote_project_${project.id}_${project.version}`, kind: 'object', sourceId: project.id,
    label: project.name, text };
}

export function memoryTopicQuote(doc: MemoryTopicDoc): Quote {
  const text = [doc.topic.title, routeHash({ view: 'memory', noteId: null, topicId: doc.topic.id }),
    doc.topic.summary, ...(doc.hardLines ?? []),
    ...doc.sections.flatMap((section) => [section.heading, ...section.lines.map((line) => {
      const basis = line.basis === 'inferred' ? '〔推断〕' : '';
      const source = line.sources.map((item) => `${item.label} [${item.kind}:${item.id}]`).join('；');
      return `${basis}${line.text}${source === '' ? '' : `（来源：${source}）`}`;
    })]),
  ].filter((part) => part !== '').join('\n');
  return { id: `quote_topic_${doc.topic.id}_${doc.composedAt}`, kind: 'object', sourceId: doc.topic.id,
    label: doc.topic.title, text };
}
