import postgres from 'postgres';

export const up = async (sql: postgres.Sql<never>): Promise<void> => {
  await sql`
    DROP TABLE verdaccio
  `;

  await sql`
    DROP TABLE files
  `;
};
