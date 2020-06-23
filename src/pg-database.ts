/* eslint-disable no-invalid-this */
import { callbackify } from 'util';

import { IPluginStorage, Logger, PluginOptions, Callback, IPackageStorage, Token, TokenFilter } from '@verdaccio/types';

import { Database } from './database';
import { TokenService } from './services/token';
import { LocalPackagesService } from './services/local-package';
import { VerdaccioSecretService } from './services/verdaccio-secret';
import { PGConfig } from './config';
import { PGPackageManager } from './pg-fs';
import { PackageService } from './services/package';

export class PGDatabase implements IPluginStorage<PGConfig> {
  public logger: Logger;
  public config: PGConfig;
  public locked: boolean;

  private database: Database;
  private token: TokenService;
  private localPackage: LocalPackagesService;
  private verdaccioSecret: VerdaccioSecretService;

  public constructor(config: PGConfig, options: PluginOptions<PGConfig>) {
    this.locked = false;
    this.logger = options.logger;

    if (!config) {
      throw new Error('[pg-storage] missing config. Add `store.pg-storage` to your config file');
    }
    this.config = Object.assign(config, config.store['pg-storage']);

    this.config.url = process.env.POSTGRES_URL || this.config.url;
    if (!this.config.url) {
      throw new Error(
        '[pg-storage] missing config. Add `store.pg-storage.url` to your config file or use environtment POSTGRES_URL'
      );
    }

    this.logger.debug({ config: JSON.stringify(this.config, null, 4) }, 'pg: configuration: @{config}');

    this.database = new Database(this.config.url);
    this.token = new TokenService(this.database, this.logger);
    this.localPackage = new LocalPackagesService(this.database, this.logger);
    this.verdaccioSecret = new VerdaccioSecretService(this.database, this.logger);
  }

  public getSecret = (): Promise<string> => this.verdaccioSecret.get();

  public setSecret = (secret: string): Promise<void> => this.verdaccioSecret.set(secret);

  public add = callbackify((name: string): Promise<void> => this.localPackage.add(name));

  public search = (onPackage: Callback, onEnd: Callback): void => {
    PackageService.search(this.database, onPackage, onEnd);
  };

  public remove = callbackify((name: string): Promise<void> => this.localPackage.remove(name));

  public get = callbackify((): Promise<string[]> => this.localPackage.get());

  public getPackageStorage = (name: string): IPackageStorage => {
    const access = this.config.getMatchedPackagesSpec(name);

    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
    const storage = (access && access.storage) || this.config.storage || 'default';

    return new PGPackageManager(this.database, this.logger, storage, name);
  };

  public clean = callbackify(() => this.localPackage.clean());

  public saveToken = (token: Token): Promise<void> => this.token.save(token);

  public deleteToken = (user: string, token: string): Promise<void> => this.token.deleteToken(user, token);

  public readTokens = (filter: TokenFilter): Promise<Token[]> => this.token.readToken(filter);
}
