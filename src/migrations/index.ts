import { readdirSync } from 'fs';
import { join } from 'path';

import postgres from 'postgres';

const initalize = async (sql: postgres.Sql<never>): Promise<void> => {
  try {
    await sql`SELECT 'migrations'::REGCLASS;`;
  } catch (err) {
    await sql`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;
  }
};

interface Migration {
  name: string;
  up: (sql: postgres.Sql<never>) => Promise<void>;
}

const executedMigrations = async (sql: postgres.Sql<never>): Promise<string[]> => {
  const rows = await sql<{ name: string }>`SELECT name FROM migrations ORDER BY id ASC`;
  return rows.map(row => row.name);
};

const definedMigrations = async (): Promise<Migration[]> => {
  const files = readdirSync(__dirname)
    .filter(name => name.match(/^[0-9]{3}\-/))
    .sort();
  const migrations = await Promise.all(
    files.map(async file => Object.assign(await import(join(__dirname, file)), { name: file }) as Migration)
  );
  return migrations;
};

export const up = async (sql: postgres.Sql<never>): Promise<string[]> => {
  await initalize(sql);
  return await sql.begin(async sql => {
    const executed = await executedMigrations(sql);
    const migrations = await definedMigrations();

    if (
      JSON.stringify(executed) !== JSON.stringify(migrations.slice(0, executed.length).map(migration => migration.name))
    ) {
      throw new Error('migration seems broken. please check if migrations file and exists is same');
    }

    const toExecute = migrations.slice(executed.length);

    await Promise.all(toExecute.map(migration => migration.up(sql)));
    await Promise.all(toExecute.map(migration => sql`INSERT INTO migrations (name) VALUES (${migration.name})`));

    return toExecute.map(migration => migration.name);
  });
};
