import { Config } from '@verdaccio/types';

export interface PGConfig extends Config {
  url?: string;
  host?: string;
  port?: string;
  path?: string;
  database?: string;
  username?: string;
  password?: string;
  ssl?: string;
  max?: string;
  idle_timeout?: string;
  connect_timeout?: string;
}
