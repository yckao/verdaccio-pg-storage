import { Config } from '@verdaccio/types';

export interface PGConfig extends Config {
  url?: string;
}
