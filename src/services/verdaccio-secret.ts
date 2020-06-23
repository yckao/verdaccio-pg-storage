/* eslint-disable no-invalid-this */
import { Logger } from '@verdaccio/types';

import { Database } from '../database';

export class VerdaccioSecretService {
  private database: Database;
  private logger: Logger;

  public constructor(database: Database, logger: Logger) {
    this.database = database;
    this.logger = logger;
  }

  public set = async (secret: string): Promise<void> => {
    const sql = await this.database.sql();

    await sql`
      INSERT INTO secrets
        (name, value, created, updated)
      VALUES
        ('verdaccio', ${secret}, NOW(), NOW())
        ON CONFLICT (name) DO UPDATE SET updated = NOW(), value = ${secret}
    `;
  };

  public get = async (): Promise<string> => {
    const sql = await this.database.sql();

    const [secret] = await sql<{ value: string }>`SELECT value FROM secrets WHERE name = 'verdaccio'`;

    return secret ? secret.value : '';
  };
}
