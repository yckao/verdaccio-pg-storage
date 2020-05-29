import postgres from 'postgres';

export const up = async (sql: postgres.Sql<never>): Promise<void> => {
  await sql`
    CREATE TABLE verdaccio (
      key bool PRIMARY KEY DEFAULT TRUE,
      value jsonb,
      created_at timestamp not null default current_timestamp,
      updated_at timestamp not null default current_timestamp
      CONSTRAINT local_packages_unique CHECK (key)
    )`;

  await sql`
    CREATE TABLE files (
      path TEXT PRIMARY KEY,
      content bytea,
      created_at timestamp not null default current_timestamp,
      updated_at timestamp not null default current_timestamp
    )`;
};
