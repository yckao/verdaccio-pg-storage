import stream, { Readable } from 'stream';

import postgres, { SerializableParameter } from 'postgres';
import { escape } from 'postgres/lib/types';

interface LevelStreamOption {
  gt?: string;
  gte?: string;
  lt?: string;
  lte?: string;
  reverse?: boolean;
  limit?: number;
  keys?: boolean;
  values?: boolean;
}

export interface Level<T> {
  put(key: string, value: T, fn?: (err: Error | null, value: T | null) => unknown): void;

  get(key: string, fn?: (err: Error | null, value: T | null) => unknown): void;

  del(key: string, fn?: (err: Error | null) => unknown): void;

  createReadStream(options?: LevelStreamOption): stream.Readable;
}

export const level = <T>(sql: postgres.Sql<never>, table: string): Level<T> => {
  const created = sql`CREATE TABLE IF NOT EXISTS ${sql(table)} (
    key   TEXT  PRIMARY KEY,
    value JSONB
  )`;

  const put = async (key: string, token: T, fn?: (err: Error | null, value: T | null) => unknown): Promise<void> => {
    await created;
    try {
      await sql`
        INSERT INTO ${sql(table)} (key, value) VALUES (${key}, ${sql.json(token)})
        ON CONFLICT (key) DO UPDATE SET value = ${sql.json(token)}
      `;
      fn?.(null, token);
    } catch (err) {
      fn?.(err, null);
    }
  };

  const get = async (key: string, fn?: (err: Error | null, value: T | null) => unknown): Promise<void> => {
    await created;
    try {
      const [{ value: value }] = await sql<{ value: T }>`SELECT value FROM ${sql(table)} WHERE key = ${key}`;
      fn?.(null, value);
    } catch (err) {
      fn?.(err, null);
    }
  };

  const del = async (key: string, fn?: (err: Error | null) => unknown): Promise<void> => {
    await created;
    try {
      await sql`DELETE FROM ${sql(table)} WHERE key = ${key}`;
      fn?.(null);
    } catch (err) {
      fn?.(err);
    }
  };

  const createReadStream = (options: LevelStreamOption): Readable => {
    const conditions: { column: string; operator: string; value: unknown }[] = [];
    let order = 'ASC';
    const limit = options.limit;
    if (options.gt) {
      conditions.push({ column: 'key', operator: '>', value: options.gt });
    }
    if (options.gte) {
      conditions.push({ column: 'key', operator: '>=', value: options.gte });
    }
    if (options.lt) {
      conditions.push({ column: 'key', operator: '<', value: options.lt });
    }
    if (options.lte) {
      conditions.push({ column: 'key', operator: '<=', value: options.lte });
    }
    if (options.reverse) {
      order = 'DESC';
    }

    const params: unknown[] = [];

    const stream = new Readable();
    const query = created.then(() =>
      sql
        .unsafe<{ key: string; value: unknown }>(
          `SELECT key, value FROM ${escape(table)} WHERE TRUE AND ${conditions
            .map(condition => `${escape(condition.column)} ${condition.operator} $${params.push(condition.value)}`)
            .join(' AND ')} AND ORDER BY key ${order} ${limit ? `LIMIT ${limit}` : ''}`,
          params as SerializableParameter[]
        )
        .stream(row => {
          stream.emit('data', { key: row.key, value: row.value });
        })
    );
    query.then(() => stream.emit('end')).catch(err => stream.emit('error', err));
    return stream;
  };

  return {
    put,
    get,
    del,
    createReadStream,
  };
};
