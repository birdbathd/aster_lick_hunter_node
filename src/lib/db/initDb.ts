import { db } from './database';
import { initTrancheTables } from './trancheDb';

let initialized = false;

export async function ensureDbInitialized(): Promise<void> {
  if (!initialized) {
    try {
      await db.initialize();
      // Initialize tranche tables
      await initTrancheTables();
      initialized = true;
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }
}