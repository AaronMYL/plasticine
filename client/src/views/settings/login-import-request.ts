import { routeHash } from '../../shell/routes.ts';
import { Store } from '../../state/store.ts';

export const loginImportRequested = new Store<boolean>(false);

export function openLoginImport(): void {
  loginImportRequested.set(true);
  window.location.hash = routeHash({ view: 'settings', noteId: null, settingsSection: 'browser' });
}
