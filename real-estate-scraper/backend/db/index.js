import knex from 'knex';
import dotenv from 'dotenv';
import knexConfig from './knexfile.js';

dotenv.config();

/**
 * Jedno sdílené DB připojení pro API i scrapery.
 * Dřív žilo v server.js — import z scraperu tím ale spouštěl i HTTP server.
 */
export const db = knex(knexConfig[process.env.NODE_ENV || 'development']);

export default db;
