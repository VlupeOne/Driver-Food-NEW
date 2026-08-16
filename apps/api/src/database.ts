import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { schemaSql } from './schema.js';

export type Database = DatabaseSync;

export function resolveDatabasePath(): string {
  return resolve(process.env.DATABASE_PATH ?? 'var/driver-food.sqlite');
}

export function createDatabase(path = resolveDatabasePath()): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const database = new DatabaseSync(path);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  if (path !== ':memory:') {
    database.exec('PRAGMA journal_mode = WAL');
  }
  database.exec(schemaSql);
  return database;
}

export function inImmediateTransaction<T>(database: Database, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function asNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}
