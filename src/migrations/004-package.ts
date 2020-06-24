/* eslint-disable prettier/prettier */
import postgres from 'postgres';

export const up = async (sql: postgres.Sql<never>): Promise<void> => {
  await sql`
    CREATE TABLE "packages" (
      "storage"    TEXT,
      "name"       TEXT,
      "json"       JSONB     NOT NULL,
      "created"    TIMESTAMP NOT NULL DEFAULT NOW(),
      "updated"    TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY ("storage", "name")
    )
  `;
};
