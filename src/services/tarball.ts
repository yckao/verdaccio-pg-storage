/* eslint-disable no-invalid-this */
import { Logger } from '@verdaccio/types';
import { UploadTarball, ReadTarball } from '@verdaccio/streams';
import { LargeObjectManager } from 'postgres-large-object';

import { Database } from '../database';

export class TarballService {
  private database: Database;
  private logger: Logger;
  private storage: string;
  private package: string;

  public constructor(database: Database, logger: Logger, storage: string, pkg: string) {
    this.database = database;
    this.logger = logger;
    this.storage = storage;
    this.package = pkg;
  }

  public write = async (name: string, upload: UploadTarball): Promise<void> => {
    this.logger.debug({ name }, '[pg-storage/tarball] write a tarball for package: @{name}');
    const sql = await this.database.sql();
    await sql.begin(async trx => {
      const manager = new LargeObjectManager(trx);
      const [exists] = await trx<{
        file: number;
      }>`SELECT file FROM tarball WHERE storage = ${this.storage} AND package = ${this.package} AND name = ${name}`;

      const [oid, stream] = await manager.createAndWritableStreamAsync();

      upload.pipe(stream);
      upload.emit('open');

      await new Promise((resolve, reject) => {
        stream.on('error', reject);
        stream.on('finish', resolve);
      });

      await trx`
        INSERT INTO tarball 
          (storage, package, name, file)
        VALUES
          (${this.storage}, ${this.package}, ${name}, ${oid})
        ON CONFLICT (storage, package, name)
        DO UPDATE
        SET 
          file = ${oid},
          updated = NOW()
      `;

      if (exists) {
        await manager.unlinkAsync(exists.file);
      }
    });
  };

  public read = async (name: string, read: ReadTarball): Promise<void> => {
    this.logger.debug({ name }, '[pg-storage/package] read a tarball for package: @{name}');
    const sql = await this.database.sql();
    await sql.begin(async trx => {
      const manager = new LargeObjectManager(trx);
      const [{ file }] = await trx<{ file: number }>`
        SELECT file FROM tarball WHERE storage = ${this.storage} AND package = ${this.package} AND name = ${name}
      `;

      const [size, stream] = await manager.openAndReadableStreamAsync(file);

      read.emit('content-length', size);
      read.emit('open');

      stream.pipe(read);

      await new Promise((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });
    });
  };

  public delete = async (name: string): Promise<void> => {
    this.logger.debug({ name }, '[pg-storage/package] delete a tarball for name: @{name}');
    const sql = await this.database.sql();
    await sql.begin(async trx => {
      const manager = new LargeObjectManager(trx);
      const rows = await trx<{ file: number }>`
        DELETE FROM tarball WHERE storage = ${this.storage} AND ${this.package} AND name = ${name} RETURNING *
      `;

      for (const row of rows) {
        await manager.unlinkAsync(row.file);
      }
    });
  };

  public remove = async (): Promise<void> => {
    this.logger.debug({ storage: this.storage }, '[pg-storage/package] remove a tarball for storage: @{storage}');
    const sql = await this.database.sql();
    await sql.begin(async trx => {
      const manager = new LargeObjectManager(trx);
      const rows = await trx<{ file: number }>`
        DELETE FROM tarball WHERE storage = ${this.storage} AND package = ${this.package} RETURNING *
      `;
      for (const row of rows) {
        await manager.unlinkAsync(row.file);
      }
    });
  };
}
