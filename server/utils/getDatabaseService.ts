import { createDatabaseService, DatabaseService } from './DatabaseService';
import getDb from './getDb';

let service: DatabaseService | null = null;

export async function getDatabaseService(): Promise<DatabaseService> {
  if (service) return service;

  const db = await getDb();
  service = createDatabaseService(db);
  return service;
}

export default getDatabaseService;
