import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Knex CLI si přepíná pracovní adresář na složku s knexfile, takže
// .env je nutné hledat podle cesty k tomuto souboru, ne podle cwd.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const connection =
  process.env.DATABASE_URL ||
  'postgresql://realestateuser:realestatepass@localhost:5432/realestate_db';

const migrations = {
  directory: path.resolve(here, 'migrations'),
  extension: 'js',
  loadExtensions: ['.js']
};

const seeds = {
  directory: path.resolve(here, 'seeds'),
  extension: 'js',
  loadExtensions: ['.js']
};

export default {
  development: { client: 'pg', connection, migrations, seeds },
  production: { client: 'pg', connection, pool: { min: 2, max: 10 }, migrations }
};
