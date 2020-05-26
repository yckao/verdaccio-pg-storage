import Path from 'path';

import _ from 'lodash';
import {
  IPluginStorage,
  Logger,
  LocalStorage,
  PluginOptions,
  Callback,
  IPackageStorage,
  Token,
  TokenFilter,
  StorageList,
} from '@verdaccio/types';
import postgres from 'postgres';
import { getInternalError } from '@verdaccio/commons-api';

import PGDriver, { TABLE_NAME as FILES_TABLE_NAME } from './pg-fs';
import { Level, level } from './level-adapter';
import { PGConfig } from './config';
import setConfigValue from './setConfigValue';

const TABLE_NAME = 'verdaccio';
const TOKEN_TABLE_NAME = 'tokens';

class PGDatabase implements IPluginStorage<PGConfig> {
  public logger: Logger;
  public config: PGConfig;
  public locked: boolean;
  public tokenDb: Level<Token>;

  private sql: postgres.Sql<never>;
  private data: Promise<LocalStorage>;

  public constructor(config: PGConfig, options: PluginOptions<PGConfig>) {
    this.locked = false;
    this.logger = options.logger;
    if (!config) {
      throw new Error('pg storage missing config. Add `store.pg-storage` to your config file');
    }
    this.config = Object.assign(config, config.store['pg-storage']);

    this.config.url = setConfigValue(this.config.url);
    this.config.host = setConfigValue(this.config.host);
    this.config.port = setConfigValue(this.config.port);
    this.config.path = setConfigValue(this.config.path);
    this.config.database = setConfigValue(this.config.database);
    this.config.username = setConfigValue(this.config.username);
    this.config.password = setConfigValue(this.config.password);
    this.config.ssl = setConfigValue(this.config.ssl);
    this.config.max = setConfigValue(this.config.max);
    this.config.idle_timeout = setConfigValue(this.config.idle_timeout);
    this.config.connect_timeout = setConfigValue(this.config.connect_timeout);

    this.logger.debug({ config: JSON.stringify(this.config, null, 4) }, 'pg: configuration: @{config}');

    if (this.config.url) {
      this.sql = postgres(this.config.url, {
        host: this.config.host,
        port: this.config.port ? +this.config.port : undefined,
        path: this.config.path,
        database: this.config.database,
        username: this.config.username,
        password: this.config.password,
        ssl: this.config.ssl === 'false' || this.config.ssl === 'true' ? this.config.ssl === 'true' : undefined,
        max: this.config.max ? +this.config.max : undefined,
        idle_timeout: this.config.idle_timeout ? +this.config.idle_timeout : undefined,
        connect_timeout: this.config.connect_timeout ? +this.config.connect_timeout : undefined,
      });
    } else {
      this.sql = postgres({
        host: this.config.host,
        port: this.config.port ? +this.config.port : undefined,
        path: this.config.path,
        database: this.config.database,
        username: this.config.username,
        password: this.config.password,
        ssl: this.config.ssl === 'false' || this.config.ssl === 'true' ? this.config.ssl === 'true' : undefined,
        max: this.config.max ? +this.config.max : undefined,
        idle_timeout: this.config.idle_timeout ? +this.config.idle_timeout : undefined,
        connect_timeout: this.config.connect_timeout ? +this.config.connect_timeout : undefined,
      });
    }

    this.data = this._fetchLocalPackages();
    this.tokenDb = level(this.sql, TOKEN_TABLE_NAME);

    this.logger.trace({ config: this.config }, '[pg-store]: configuration: @{config}');

    this._sync();
  }

  public async getSecret(): Promise<string> {
    return (await this.data).secret;
  }

  public setSecret(secret: string): Promise<Error | null> {
    this.data = this.data.then(data => ({ ...data, secret }));
    return this._sync();
  }

  public async add(name: string, cb: Callback): Promise<void> {
    if (!(await this.data).list.includes(name)) {
      this.data = this.data.then(data => ({ ...data, list: data.list.concat(name) }));

      this.logger.debug({ name }, '[pg-storage]: the private package @{name} has been added');
      cb(await this._sync());
    } else {
      cb(null);
    }
  }

  public async search(onPackage: Callback, onEnd: Callback): Promise<void> {
    try {
      await this.sql<{ path: string; content: Buffer; updated_at: Date }>`
        SELECT path, content, updated_at FROM ${this.sql(FILES_TABLE_NAME)} WHERE path LIKE '%/package.json'
      `.stream(({ path, content, updated_at: LastModified }) => {
        const pkg = JSON.parse(content.toString('utf8'));
        return onPackage({
          name: pkg.name,
          path: path,
          time: LastModified.getTime(),
        });
      });
      onEnd();
    } catch (err) {
      onEnd(err);
    }
  }

  public remove(name: string, cb: Callback): void {
    this.get(async (err, list) => {
      if (err) {
        cb(getInternalError('error remove private package'));
        this.logger.error({ err }, '[pg-storage/remove]: remove the private package has failed @{err}');
      }

      this.data = this.data.then(data => ({ ...data, list: list.filter((pkgName: string) => pkgName !== name) }));
      cb(await this._sync());
    });
  }

  public async get(cb: Callback): Promise<void> {
    const list = (await this.data).list;
    const totalItems = (await this.data).list.length;

    cb(null, list);

    this.logger.trace({ totalItems }, '[pg-storage/get]: full list of packages (@{totalItems}) has been fetched');
  }

  public getPackageStorage(packageName: string): IPackageStorage {
    const packageAccess = this.config.getMatchedPackagesSpec(packageName);

    const packagePath: string = this._getLocalStoragePath(packageAccess ? packageAccess.storage : undefined);
    this.logger.trace({ packagePath }, '[pg-storage/getPackageStorage]: storage selected: @{packagePath}');

    if (_.isString(packagePath) === false) {
      this.logger.debug({ name: packageName }, 'this package has no storage defined: @{name}');
      return;
    }

    const packageStoragePath: string = Path.join(
      Path.resolve(Path.dirname(this.config.self_path || ''), packagePath),
      packageName
    );

    this.logger.trace({ packageStoragePath }, '[pg-storage/getPackageStorage]: storage path: @{packageStoragePath}');

    return new PGDriver(this.sql, packageStoragePath, this.logger);
  }

  public clean(): void {
    this._sync();
  }

  public saveToken(token: Token): Promise<void> {
    const key = this._getTokenKey(token);
    const db = this.tokenDb;

    return new Promise((resolve, reject): void => {
      db.put(key, token, err => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  public deleteToken(user: string, tokenKey: string): Promise<void> {
    const key = this._compoundTokenKey(user, tokenKey);
    const db = this.tokenDb;
    return new Promise((resolve, reject): void => {
      db.del(key, err => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  public readTokens(filter: TokenFilter): Promise<Token[]> {
    return new Promise((resolve, reject): void => {
      const tokens: Token[] = [];
      const key = filter.user + ':';
      const db = this.tokenDb;
      const stream = db.createReadStream({
        gte: key,
        lte: String.fromCharCode(key.charCodeAt(0) + 1),
      });

      stream.on('data', data => {
        tokens.push(data.value);
      });

      stream.once('end', () => resolve(tokens));

      stream.once('error', err => reject(err));
    });
  }

  private async _fetchLocalPackages(): Promise<LocalStorage> {
    const list: StorageList = [];
    const emptyDatabase = { list, secret: '' };

    try {
      const [{ value: value }] = await this.sql<{ value: LocalStorage }>`SELECT value FROM ${this.sql(TABLE_NAME)}`;

      return value;
    } catch (err) {
      // Only recreate if table not found to prevent data loss undefined_table
      if (err.code !== '42P01') {
        this.locked = true;
        this.logger.error(
          'Failed to read package database table, please check the error printed below:\n',
          `Table Name: ${TABLE_NAME}\n\n ${err.message}`
        );
      }

      return emptyDatabase;
    }
  }

  private async _sync(): Promise<Error | null> {
    this.logger.debug('[pg-storage/_sync]: init sync database');

    if (this.locked) {
      this.logger.error('Database is locked, please check error message printed during startup to prevent data loss.');
      return new Error(
        'Verdaccio database is locked, please contact your administrator to checkout logs during verdaccio startup.'
      );
    }

    try {
      await this.sql`CREATE TABLE IF NOT EXISTS ${this.sql(TABLE_NAME)} (
        key bool PRIMARY KEY DEFAULT TRUE,
        value jsonb,
        created_at timestamp not null default current_timestamp,
        updated_at timestamp not null default current_timestamp
        CONSTRAINT local_packages_unique CHECK (key)
      )`;

      this.logger.debug({ tableName: TABLE_NAME }, '[pg-storage/_sync]: table @{tableName} created succeed');
    } catch (err) {
      this.logger.debug({ err }, '[pg-storage/_sync/create-table-if-not-exists]: sync failed @{err}');

      return null;
    }

    try {
      await this.sql`
        INSERT INTO ${this.sql(TABLE_NAME)} (key, value, updated_at) VALUES (TRUE, ${this.sql.json(
        await this.data
      )}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = ${this.sql.json(await this.data)}
      `;
      this.logger.debug('[pg-store/_sync/update_statement]: sync write succeed');

      return null;
    } catch (err) {
      this.logger.debug({ err }, '[pg-store/_sync/update/statement]: sync failed$ @{err}');

      return err;
    }
  }

  private _getLocalStoragePath(storage: string | void): string {
    const globalConfigStorage = this.config ? this.config.storage : undefined;
    if (_.isNil(globalConfigStorage)) {
      throw new Error('global storage is required for this plugin');
    } else {
      if (_.isNil(storage) === false && _.isString(storage)) {
        return Path.join(globalConfigStorage as string, storage as string);
      }

      return globalConfigStorage as string;
    }
  }

  private _getTokenKey(token: Token): string {
    const { user, key } = token;
    return this._compoundTokenKey(user, key);
  }

  private _compoundTokenKey(user: string, key: string): string {
    return `${user}:${key}`;
  }
}

export default PGDatabase;
