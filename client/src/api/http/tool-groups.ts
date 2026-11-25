import type { ToolGroupApi } from '../tool-groups-client.ts';
import { HttpBrowser, HttpNoteVersions, HttpToolGroups } from './browser.ts';
import { HttpInbox } from './inbox.ts';
import { HttpMoney } from './money.ts';
import type { Transport } from './transport.ts';
import { HttpFiles } from './workspace.ts';
import { HttpSkills } from './capabilities.ts';

export function createToolGroupHttp(transport: Transport): ToolGroupApi {
  return {
    skills: new HttpSkills(transport),
    money: new HttpMoney(transport),
    inbox: new HttpInbox(transport),
    toolGroups: new HttpToolGroups(transport),
    files: new HttpFiles(transport),
    browser: new HttpBrowser(transport),
    noteVersions: new HttpNoteVersions(transport),
  };
}
