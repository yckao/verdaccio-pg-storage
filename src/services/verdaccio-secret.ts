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
    this.logger.debug('[pg-storage/verdaccio-secret]: save secret');
    const sql = await this.database.sql();

    await sql`
      INSERT INTO secrets
        (name, value, created, updated)
      VALUES
        ('verdaccio', ${secret}, NOW(), NOW())
        ON CONFLICT (name) DO UPDATE SET updated = NOW(), value = ${secret}
    `;

    this.logger.debug('[pg-storage/verdaccio-secret]: secret saved');
  };

  public get = async (): Promise<string> => {
    this.logger.debug('[pg-storage/verdaccio-secret]: get secret');
    const sql = await this.database.sql();

    const [secret] = await sql<{ value: string }>`SELECT value FROM secrets WHERE name = 'verdaccio'`;

    this.logger.debug('[pg-storage/verdaccio-secret]: secret saved');
    return secret ? secret.value : '';
  };
}
