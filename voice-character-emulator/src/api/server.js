import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { VoiceGenerator } from './voice-generator.js';
import { CharacterStore } from './character-store.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../web')));
app.use('/audio', express.static(path.join(__dirname, '../../voices/generated')));

// Initialize stores
const characters = new CharacterStore();
const voiceGen = new VoiceGenerator();

// Routes
app.get('/api/characters', (req, res) => {
  res.json(characters.list());
});

app.get('/api/emotions', (req, res) => {
  res.json(characters.emotions());
});

app.post('/api/generate', async (req, res) => {
  try {
    const { text, character, emotion = 'neutral', language = 'en', dubbing_type = 'synthetic' } = req.body;

    if (!text || !character) {
      return res.status(400).json({ error: 'Missing text or character' });
    }

    // Validate character exists
    const char = characters.get(character);
    if (!char) {
      return res.status(404).json({ error: 'Character not found' });
    }

    // Generate audio
    const result = await voiceGen.generate({
      text,
      character,
      emotion,
      language,
      dubbing_type,
      char_metadata: char
    });

    res.json(result);
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'voice-character-emulator' });
});

app.listen(PORT, () => {
  console.log(`🎭 Voice Character Emulator running on http://localhost:${PORT}`);
  console.log(`📝 Characters: ${characters.list().map(c => c.name).join(', ')}`);
});
