import postgres from 'postgres';

export const up = async (sql: postgres.Sql<never>): Promise<void> => {
  await sql`
    ALTER TABLE files ADD COLUMN temp oid;
  `;

  await sql`
    UPDATE files
    SET temp = lo_from_bytea(0, content);
  `;

  await sql`
    ALTER TABLE files DROP COLUMN content;
  `;

  await sql`
    ALTER TABLE "public"."files" RENAME COLUMN "temp" TO "content";
  `;
};
