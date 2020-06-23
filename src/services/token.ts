/* eslint-disable no-invalid-this */
import { Token as VerdaccioToken, TokenFilter } from '@verdaccio/types';

import { Database } from '../database';

export interface Token {
  user: string;
  token: string;
  key: string;
  cidr?: string[];
  readonly: boolean;
  created: Date;
  updated?: Date;
}

export class TokenService {
  private database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  public save = async (token: VerdaccioToken): Promise<void> => {
    const sql = await this.database.sql();
    await sql`
      INSERT INTO tokens ${sql(TokenService.fromVerdaccioToken(token) as {})}
    `;
  };

  public deleteToken = async (user: string, key: string): Promise<void> => {
    const sql = await this.database.sql();
    await sql`
      DELETE FROM tokens WHERE user = ${user} AND key = ${key}
    `;
  };

  public readToken = async ({ user }: TokenFilter): Promise<VerdaccioToken[]> => {
    const sql = await this.database.sql();
    const rows = await sql<Token[]>`SELECT * FROM tokens WHERE user = ${user}`;
    return rows.map(TokenService.toVerdaccioToken);
  };

  public static toVerdaccioToken = (token: Token): VerdaccioToken => {
    return {
      ...token,
      created: token.created.getTime(),
      updated: token.updated && token.updated.getTime(),
    };
  };

  public static fromVerdaccioToken = (token: VerdaccioToken): Token => {
    return {
      ...token,
      created: new Date(token.created),
      updated: (token.updated && new Date(token.updated)) || undefined,
    };
  };
}
