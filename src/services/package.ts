/* eslint-disable no-invalid-this */
import { promisify } from 'util';

import { Logger, Package as VerdaccioPackage, Callback } from '@verdaccio/types';
import * as VerdaccioError from '@verdaccio/commons-api';

import { Database } from '../database';

export class PackageService {
  private database: Database;
  private logger: Logger;

  private storage: string;
  private name: string;

  public static search = async (database: Database, onPackage: Callback, onEnd: Callback): Promise<void> => {
    const sql = await database.sql();
    await sql<{
      json: VerdaccioPackage;
      updated: Date;
    }>`SELECT json, updated FROM packages`.stream(({ json, updated }) => {
      return onPackage({
        name: json.name,
        path: json.name,
        time: updated.getTime(),
      });
    });
    onEnd();
  };

  public constructor(database: Database, logger: Logger, storage: string, name: string) {
    this.database = database;
    this.logger = logger;
    this.storage = storage;
    this.name = name;
  }

  public create = async (name: string, json: VerdaccioPackage): Promise<void> => {
    this.logger.debug({ name }, '[pg-storage/package] create a package: @{name}');

    await this.save(name, json);
  };

  public save = async (name: string, json: VerdaccioPackage): Promise<void> => {
    this.logger.debug({ name }, '[pg-storage/package] save a package: @{name}');

    const sql = await this.database.sql();
    await sql`
      INSERT INTO packages 
        (storage, name, json)
      VALUES
        (${this.storage}, ${name}, ${sql.json(json)})
      ON CONFLICT (storage, name)
      DO UPDATE
      SET 
        json = ${sql.json(json)},
        updated = NOW()
    `;
  };

  public update = async (
    name: string,
    updateHandler: Callback,
    onWrite: Callback,
    transformPackage: Function
  ): Promise<void> => {
    this.logger.debug({ name }, '[pg-storage/package] update a package: @{name}');

    const updateHandlerAsync = promisify(updateHandler);
    const onWriteAsync = promisify(onWrite);

    const pkg = await this.read(name);
    await updateHandlerAsync(pkg);

    const transformed = transformPackage(pkg);

    await onWriteAsync(name, transformed);
  };

  public read = async (name: string): Promise<VerdaccioPackage> => {
    this.logger.debug({ name }, '[pg-storage/package] read a package: @{name}');
    const sql = await this.database.sql();

    const [pkg] = await sql<{ json: VerdaccioPackage }>`
      SELECT json FROM packages WHERE storage = ${this.storage} AND name = ${name}
    `;
    if (!pkg) {
      throw VerdaccioError.getNotFound();
    }
    return pkg.json;
  };

  public delete = async (): Promise<void> => {
    this.logger.debug({ name: this.name }, '[pg-storage/package] delete a package @{name}');
    const sql = await this.database.sql();

    await sql`DELETE FROM packages WHERE storage = ${this.storage} AND name = ${this.name}`;
  };
}
