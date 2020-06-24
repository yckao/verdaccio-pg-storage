/* eslint-disable prettier/prettier */
import postgres from 'postgres';

export const up = async (sql: postgres.Sql<never>): Promise<void> => {
  await sql`
    DROP TABLE IF EXISTS "tokens";
  `;

  await sql`
    CREATE TABLE "tokens" (
      "id"         SERIAL,
      "user"       TEXT      NOT NULL,
      "token"      TEXT      NOT NULL,
      "key"        TEXT      NOT NULL,
      "cidr"       TEXT[],
      "readonly"   BOOLEAN   NOT NULL,
      "created"    TIMESTAMP NOT NULL,
      "updated"    TIMESTAMP,
      PRIMARY KEY ("id")
    )`;
};
