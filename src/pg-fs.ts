/* eslint-disable no-invalid-this */
import { callbackify } from 'util';

import { ILocalPackageManager, Logger, Callback, Package } from '@verdaccio/types';
import { UploadTarball, ReadTarball } from '@verdaccio/streams';

import { Database } from './database';
import { PackageService } from './services/package';
import { TarballService } from './services/tarball';

const noop = (): void => {
  // Make linter happy
};

export class PGPackageManager implements ILocalPackageManager {
  public logger: Logger;

  private package: PackageService;
  private tarball: TarballService;

  public constructor(database: Database, logger: Logger, storage: string, name: string) {
    this.logger = logger;
    this.package = new PackageService(database, logger, storage, name);
    this.tarball = new TarballService(database, logger, storage, name);
  }

  public updatePackage = callbackify(
    (name: string, updateHandler: Callback, onWrite: Callback, transformPackage: Function): Promise<void> =>
      this.package.update(name, updateHandler, onWrite, transformPackage)
  );

  public deletePackage = callbackify(
    async (name: string): Promise<void> => {
      if (name === 'package.json') {
        await this.package.delete();
      } else {
        await this.tarball.delete(name);
      }
    }
  );

  public removePackage = callbackify(
    async (): Promise<void> => {
      await this.package.delete();
      await this.tarball.remove();
    }
  );

  public createPackage = callbackify((name: string, value: Package): Promise<void> => this.package.create(name, value));

  public savePackage = callbackify((name: string, value: Package): Promise<void> => this.package.save(name, value));

  public readPackage = callbackify((name: string) => this.package.read(name));

  public writeTarball = (name: string): UploadTarball => {
    const upload = new UploadTarball({});
    let ended = false;
    upload.on('end', () => {
      ended = true;
    });

    this.tarball.write(name, upload);

    upload.done = (): void => {
      const onEnd = (): void => {
        upload.emit('success');
      };
      if (ended) {
        onEnd();
      } else {
        upload.on('end', onEnd);
      }
    };

    upload.abort = noop;
    return upload;
  };

  public readTarball = (name: string): ReadTarball => {
    const read = new ReadTarball({});

    this.tarball.read(name, read);

    return read;
  };
}
