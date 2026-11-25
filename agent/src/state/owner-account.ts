import type { Row } from './db.ts';
import type { StoreContext } from './object-store.ts';

const OWNER_ID = 'owner';

export interface OwnerAccount {
  displayName: string | null;
  passwordSetAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OwnerCredentials {
  hash: string;
  salt: string;
}

function textOrNull(row: Row, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : String(value);
}

function view(row: Row): OwnerAccount {
  return { displayName: textOrNull(row, 'display_name'), passwordSetAt: textOrNull(row, 'password_set_at'),
    createdAt: String(row['created_at']), updatedAt: String(row['updated_at']) };
}

export function createOwnerAccountStore(context: StoreContext) {
  const { db } = context;
  const read = (): Row | undefined => db.get('SELECT * FROM owner_account WHERE id = $id', { id: OWNER_ID });

  function write(assignments: string, params: Record<string, string | null>): OwnerAccount {
    const at = context.now();
    return db.transaction(() => {
      db.run(`INSERT INTO owner_account (id, created_at, updated_at) VALUES ($id, $at, $at)
        ON CONFLICT (id) DO NOTHING`, { id: OWNER_ID, at });
      db.run(`UPDATE owner_account SET ${assignments}, updated_at = $at WHERE id = $id`,
        { ...params, id: OWNER_ID, at });
      const row = read();
      if (row === undefined) {
        throw new Error('主人账号写入后读不到');
      }
      return view(row);
    });
  }

  return {
    get(): OwnerAccount | undefined {
      const row = read();
      return row === undefined ? undefined : view(row);
    },
    credentials(): OwnerCredentials | null {
      const row = read();
      const hash = row === undefined ? null : textOrNull(row, 'password_hash');
      const salt = row === undefined ? null : textOrNull(row, 'password_salt');
      return hash === null || salt === null ? null : { hash, salt };
    },
    setName(displayName: string): OwnerAccount {
      return write('display_name = $name', { name: displayName });
    },
    setPassword(hash: string, salt: string, at: string): OwnerAccount {
      return write('password_hash = $hash, password_salt = $salt, password_set_at = $set_at',
        { hash, salt, set_at: at });
    },
    issueSetupToken(tokenHash: string, expiresAt: string): OwnerAccount {
      return write('setup_token_hash = $token, setup_token_expires_at = $expires',
        { token: tokenHash, expires: expiresAt });
    },
    takeSetupToken(tokenHash: string, at: string): boolean {
      return db.run(`UPDATE owner_account SET setup_token_hash = NULL, setup_token_expires_at = NULL,
        updated_at = $at WHERE id = $id AND setup_token_hash = $token AND setup_token_expires_at > $at`,
      { id: OWNER_ID, token: tokenHash, at }) === 1;
    },
  };
}

export type OwnerAccountStore = ReturnType<typeof createOwnerAccountStore>;
