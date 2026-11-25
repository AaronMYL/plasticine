import type { IconName } from './icons.tsx';
import { TOOL_ICONS, type Route } from './routes.ts';
import { SECTIONS, sectionOf } from './sections.ts';

export function pageIcon(route: Route | null): IconName {
  if (route === null) {
    return 'globe';
  }
  switch (route.view) {
    case 'notes': return 'notes';
    case 'books':
      if (route.spaceId != null) return 'space';
      return route.spacesList === true ? 'archive' : 'books';
    case 'projects': return 'folder';
    case 'feed': return 'feed';
    case 'messages':
    case 'contacts': return 'person';
    case 'memory': return 'memory';
    case 'skills': return 'sparkle';
    case 'tools': return route.tool == null ? 'tools' : TOOL_ICONS[route.tool];
    case 'browser': return 'globe';
    default: {
      const icon = SECTIONS[sectionOf(route)].icon;
      return icon === 'mark' ? 'conversation' : icon;
    }
  }
}
