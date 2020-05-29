/* eslint-disable no-invalid-this */
import path from 'path';
import { Readable } from 'stream';
import { callbackify } from 'util';

import { ILocalPackageManager, Logger, Callback, Package, IUploadTarball } from '@verdaccio/types';
import { getCode, VerdaccioError } from '@verdaccio/commons-api/lib';
import postgres from 'postgres';
import { UploadTarball, ReadTarball } from '@verdaccio/streams';

export const TABLE_NAME = 'files';
export const PKG_FILE_NAME = 'package.json';
export const ERROR_NO_SUCH_FILE: VerdaccioError = new Error('no such file');
ERROR_NO_SUCH_FILE.code = 'ENOENT';
export const ERROR_FILE_EXIST: VerdaccioError = new Error('file exist');
ERROR_FILE_EXIST.code = 'EEXISTS';
export type IPGPackageManager = ILocalPackageManager & { prefix: string };
const noop = (): void => {
  // Make linter happy
};

export default class PGPackageManager implements IPGPackageManager {
  public prefix: string;
  public logger: Logger;

  private sql: postgres.Sql<never>;
  private ready: Promise<void>;

  public constructor(opts: { sql: postgres.Sql<never>; ready: Promise<void>; prefix: string; logger: Logger }) {
    this.sql = opts.sql;
    this.ready = opts.ready;
    this.prefix = opts.prefix;
    this.logger = opts.logger;
  }

  public async updatePackage(
    name: string,
    updateHandler: Callback,
    onWrite: Callback,
    transformPackage: Function,
    onEnd: Callback
  ): Promise<void> {
    this.logger.debug({ name }, '[pg-storage/updatePackage]: update package init ${name}');
    try {
      const buffer = await this._readStorageFile(this._getStorage(PKG_FILE_NAME));
      const json = JSON.parse(buffer.toString('utf8'));
      updateHandler(json, err => {
        if (err) {
          this.logger.error({ err }, '[pg-storage/updatePackage/updateHandler]: onEnd @{err}');
          onEnd(err);
        } else {
          const transformed = transformPackage(json);
          this.logger.debug({ transformed }, '[pg-storage/updatePackage/updateHandler]: onWrite @{transformed}');
          onWrite(name, transformed, onEnd);
        }
      });
    } catch (err) {
      this.logger.error({ err }, '[pg-storage/updatePackage/updateHandler]: onEnd catch @{err}');

      return onEnd(err);
    }
    return;
  }

  public deletePackage = callbackify(async (packageName: string) => {
    this.logger.debug({ packageName }, '[local-storage/deletePackage] delete a package @{packageName}');
    await this._deleteFile(this._getStorage(packageName));
  });

  public removePackage = callbackify(async () => {
    this.logger.debug({ packageName: this.prefix }, '[pg-storage/removePackage] remove a package: @{packageName}');

    await this._deletePrefix(this._getStorage('.'));
  });

  public createPackage = callbackify(async (name: string, value: Package) => {
    this.logger.debug({ packageName: name }, '[pg-storage/createPackage] create a package: @{packageName}');
    this._createFile(this._getStorage(PKG_FILE_NAME), this._convertToString(value));
  });

  public savePackage = callbackify(async (name: string, value: Package) => {
    this.logger.debug({ packageName: name }, '[pg-storage/savePackage] save a package: @{packageName}');

    await this._writeFile(this._getStorage(PKG_FILE_NAME), Buffer.from(this._convertToString(value)));
  });

  public readPackage = callbackify(async (name: string) => {
    this.logger.debug({ packageName: name }, '[pg-storage/readPackage] read a package: @{packageName}');
    try {
      const file = await this._readStorageFile(this._getStorage(PKG_FILE_NAME));
      const data = JSON.parse(file.toString('utf8'));

      this.logger.trace(
        { packageName: name },
        '[pg-storage/readPackage/_readStorageFile] read a package succeed: @{packageName}'
      );
      return data;
    } catch (err) {
      this.logger.trace({ err }, '[local-storage/readPackage/_readStorageFile] error on read a package: @{err}');
      throw err;
    }
  });

  public writeTarball(name: string): IUploadTarball {
    const uploadStream = new UploadTarball({});
    this.logger.debug({ packageName: name }, '[pg-storage/writeTarball] write a tarball for package: @{packageName}');

    let ended = false;
    uploadStream.on('end', function() {
      ended = true;
    });

    const pathName: string = this._getStorage(name);

    (async (): Promise<void> => {
      try {
        await this._readStorageFile(pathName);
        uploadStream.emit('error', getCode(409, ERROR_FILE_EXIST.message));
      } catch (err) {
        if (err != ERROR_NO_SUCH_FILE) {
          uploadStream.emit('error', err);
        }
      }
      const chunks: Uint8Array[] = [];
      uploadStream.on('data', data => chunks.push(data));

      uploadStream.done = (): void => {
        const query = async (): Promise<void> => {
          const buffer = Buffer.concat(chunks);
          try {
            await this._writeFile(pathName, buffer);
            uploadStream.emit('success');
          } catch (err) {
            uploadStream.emit('error', err);
          }
        };
        if (ended) {
          query();
        } else {
          uploadStream.on('end', query);
        }
      };

      uploadStream.abort = noop;
      uploadStream.emit('open');
    })();

    return uploadStream;
  }

  public readTarball(name: string): ReadTarball {
    const pathName: string = this._getStorage(name);
    this.logger.debug({ packageName: name }, '[pg-storage/readTarball] read a tarball for package: @{packageName}');

    const readTarballStream = new ReadTarball({});
    const query = async (): Promise<void> => {
      try {
        const file = await this._readStorageFile(pathName);
        readTarballStream.emit('content-length', file.byteLength);
        readTarballStream.emit('open');
        Readable.from(file).pipe(readTarballStream);
      } catch (err) {
        readTarballStream.emit('error', err);
      }
    };

    query();

    return readTarballStream;
  }

  private async _createFile(name: string, contents: string): Promise<void> {
    await this.ready;
    this.logger.trace({ name }, '[pg-storage/_createFile] create a new file: @{name}');
    try {
      await this._readStorageFile(name);
      this.logger.trace({ name }, '[pg-storage/_createFile] file cannot be created, it already exists: @{name}');
    } catch (err) {
      if (err == ERROR_NO_SUCH_FILE) {
        await this._writeFile(name, Buffer.from(contents));
        this.logger.trace({ name }, '[pg-storage/_createFile] write file succeed: @{name}');
      }
    }
    throw getCode(409, 'EEXIST');
  }

  private async _readStorageFile(name: string): Promise<Buffer> {
    await this.ready;
    this.logger.trace({ name }, '[pg-storage/_readStorageFile] read a file: @{name}');

    try {
      const rows = await this.sql<{ content: Buffer }>`SELECT content FROM ${this.sql(
        TABLE_NAME
      )} WHERE path = ${name}`;
      if (rows.count === 0) {
        throw ERROR_NO_SUCH_FILE;
      }

      const [{ content: data }] = rows;
      this.logger.trace({ name }, '[pg-storage/_readStorageFile] read file succeed: @{name}');

      return data;
    } catch (err) {
      if (err != ERROR_NO_SUCH_FILE) {
        this.logger.trace({ name }, '[pg-storage/_readStorageFile] error on read the file: @{name}');
      } else {
        this.logger.trace({ name }, '[pg-storage/_readStorageFile] error no such file: @{name}');
      }

      throw err;
    }
  }

  private _convertToString(value: Package): string {
    return JSON.stringify(value, null, '\t');
  }

  private _getStorage(fileName = ''): string {
    const storagePath: string = path.join(this.prefix, fileName);

    return storagePath;
  }

  private async _writeFile(dest: string, data: Buffer): Promise<void> {
    await this.ready;
    await this.sql.begin(async sql => {
      await sql`
        INSERT INTO ${sql(TABLE_NAME)} (path, content, updated_at) VALUES (${dest}, ${data}, NOW())
        ON CONFLICT (path) DO UPDATE SET content = ${Buffer.from(data)}
      `;
    });
  }

  private async _deleteFile(name: string): Promise<void> {
    await this.ready;
    await this.sql`
      DELETE FROM ${this.sql(TABLE_NAME)} WHERE path = ${name}
    `;
  }

  private async _deletePrefix(prefix: string): Promise<void> {
    await this.ready;
    await this.sql`
      DELETE FROM ${this.sql(TABLE_NAME)} WHERE path = ${prefix + '%'}
    `;
  }
}
