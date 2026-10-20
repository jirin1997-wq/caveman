import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, '.')));

// Data endpoint
app.get('/data/listings.json', (req, res) => {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'data', 'listings.json'), 'utf-8');
    res.set('Content-Type', 'application/json');
    res.send(data);
  } catch (err) {
    res.status(500).json({ error: 'Data not available' });
  }
});

// Root redirect to calculator
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'reality-calc.html'));
});

app.listen(PORT, () => {
  console.log(`✓ Realitní server na http://localhost:${PORT}`);
  console.log(`  Kalkulátor: ${PORT}`);
  console.log(`  Data: ${PORT}/data/listings.json`);
});
