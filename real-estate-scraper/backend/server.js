import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import knex from 'knex';
import knexConfig from './db/knexfile.js';

dotenv.config();

const app = express();
const db = knex(knexConfig[process.env.NODE_ENV || 'development']);
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Listings - seznam s filtry
app.get('/api/listings', async (req, res) => {
  try {
    const { city = 'praha', minPrice, maxPrice, minSize, maxSize, rooms, sortBy = 'updated_at' } = req.query;

    let query = db('listings').where('city', city);

    if (minPrice) query = query.andWhere('price', '>=', minPrice);
    if (maxPrice) query = query.andWhere('price', '<=', maxPrice);
    if (minSize) query = query.andWhere('size_m2', '>=', minSize);
    if (maxSize) query = query.andWhere('size_m2', '<=', maxSize);
    if (rooms) query = query.andWhere('rooms', rooms);

    const listings = await query
      .orderBy(sortBy, 'desc')
      .limit(100);

    res.json(listings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Listing detail + price history
app.get('/api/listings/:id', async (req, res) => {
  try {
    const listing = await db('listings').where('id', req.params.id).first();
    if (!listing) return res.status(404).json({ error: 'Not found' });

    const priceHistory = await db('price_history')
      .where('listing_id', req.params.id)
      .orderBy('recorded_at', 'asc');

    res.json({ ...listing, priceHistory });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Price trend for chart
app.get('/api/listings/:id/price-trend', async (req, res) => {
  try {
    const history = await db('price_history')
      .where('listing_id', req.params.id)
      .orderBy('recorded_at', 'asc')
      .select('recorded_at as date', 'price', 'price_per_m2');

    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DB connection check
app.listen(PORT, async () => {
  try {
    await db.raw('SELECT 1');
    console.log(`✓ Server running on :${PORT}`);
    console.log(`✓ Database connected`);
  } catch (err) {
    console.error('✗ Database connection failed:', err.message);
    process.exit(1);
  }
});

export { db };
