import { createDatabase, resolveDatabasePath } from './database.js';
import { seedDatabase } from './seed.js';

const path = resolveDatabasePath();
const database = createDatabase(path);
const seeded = seedDatabase(database);
database.close();

console.log(seeded ? `Banco de demonstração criado em ${path}.` : `Banco em ${path} já possui dados.`);
