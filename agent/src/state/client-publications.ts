// 界面每换一版，部署脚本写一份发布回执；这里一份回执记一行（重复的不再记），本机备份的清单用最近一行认「这份备份是
// 哪一版界面时做的」。11-17：原来还把每一版的整份资源清单存进 client_updates（自迭代时代给「发布提请」挑候选用的），
// 那套接口和表都删了。

import { ClientPublicationSchema, type ClientPublication } from '../../shared/api/client-updates.ts';
import { checked } from './codec.ts';
import type { StoreContext } from './object-store.ts';

export function createClientPublicationStore({ db }: StoreContext) {
  return {
    /** 记下这份回执；以前记过的回 false。 */
    publish(receipt: ClientPublication): boolean {
      const value = checked(ClientPublicationSchema, receipt, 'invalid_input', '客户端发布回执');
      return db.run('INSERT OR IGNORE INTO client_publications (id, metadata) VALUES ($id, $metadata)', {
        id: value.id,
        metadata: JSON.stringify(value),
      }) > 0;
    },
  };
}

export type ClientPublicationStore = ReturnType<typeof createClientPublicationStore>;
