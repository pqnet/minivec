import { getLoadablePath, load } from "sqlite-vec";
import type { Connector, Database } from "db0";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
let initialized = false;
export async function getDb() {
  const db: Database<Connector<BetterSqlite3Database>> = useDatabase();
  if (!initialized) {
    initialized = true;
    const instance =
      (await db.getInstance()) as unknown as BetterSqlite3Database;
    load(instance);
    await db.sql`create table if not exists documents (
      id integer primary key autoincrement,
      content text not null,
      metadata blob not null,
      embedding blob not null check(vec_length(embedding) > 0));`;
  }
  return db;
}
export default getDb;
