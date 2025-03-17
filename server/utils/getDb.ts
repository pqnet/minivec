import { getLoadablePath, load } from "sqlite-vec";
import type { Connector, Database } from "db0";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { migrate } from "../database/schema";
import { load as sqliteVecLoad } from "sqlite-vec";

let initialized = false;

export async function getDb() {
  const db: Database<Connector<BetterSqlite3Database>> = useDatabase();

  if (initialized) return db;

  // Load sqlite-vec extension
  sqliteVecLoad(await db.getInstance());

  // Run migrations
  await migrate(db);

  initialized = true;
  return db;
}

export default getDb;
