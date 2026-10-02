import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get('/data/listings.json', (req, res) => {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'data', 'listings.json'), 'utf-8');
    res.set('Content-Type', 'application/json');
    res.send(data);
  } catch (err) {
    console.error('Chyba:', err.message);
    res.status(500).json({ error: 'Nelze načíst data' });
  }
});

app.listen(PORT, () => {
  console.log(`✓ Dashboard server na http://localhost:${PORT}`);
  console.log(`  Přístup do dashboardu: https://claude.ai/artifact/3hcUH8vhoDz51zWVPFnKUy`);
});
