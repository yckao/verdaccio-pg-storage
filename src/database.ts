/* eslint-disable no-invalid-this */
import postgres from 'postgres';

import * as migrations from './migrations';

export class Database {
  private _sql: postgres.Sql<never>;
  public ready: Promise<boolean>;

  public constructor(url: string) {
    this._sql = postgres(url);
    this.ready = this.initialize();
  }

  public sql = async (): Promise<postgres.Sql<never>> => {
    await this.ready;
    return this._sql;
  };

  private initialize = async (): Promise<boolean> => {
    await migrations.up(this._sql);
    return true;
  };
}
