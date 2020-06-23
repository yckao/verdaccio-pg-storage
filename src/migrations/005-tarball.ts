/* eslint-disable prettier/prettier */
import postgres from 'postgres';

export const up = async (sql: postgres.Sql<never>): Promise<void> => {
  await sql`
    CREATE TABLE "tarball" (
      "storage" TEXT,
      "package" TEXT,
      "name"    TEXT,
      "file"    OID   NOT NULL,
      "created"    TIMESTAMP NOT NULL DEFAULT NOW(),
      "updated"    TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY ("storage", "package", "name")
    );
  `;
};