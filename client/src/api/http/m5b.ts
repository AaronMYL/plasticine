// M5 乙路几组真实现装在一起，http/index.ts 只展开这一处。

import type { M5bApi } from '../m5b-client.ts';
import { HttpBrowser, HttpNoteVersions, HttpToolGroups } from './browser.ts';
import { HttpInbox } from './inbox.ts';
import { HttpMoney } from './money.ts';
import type { Transport } from './transport.ts';
import { HttpFiles } from './workspace.ts';
import { HttpSkills } from './capabilities.ts';

export function createM5bHttp(transport: Transport): M5bApi {
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
