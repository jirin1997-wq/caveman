import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class CharacterStore {
  constructor() {
    this.characters_path = path.join(__dirname, '../characters/characters.json');
    this.emotions_path = path.join(__dirname, '../emotions/emotions.json');

    this.characters = JSON.parse(fs.readFileSync(this.characters_path, 'utf8'));
    this.emotions_data = JSON.parse(fs.readFileSync(this.emotions_path, 'utf8'));
  }

  list() {
    return Object.entries(this.characters).map(([key, char]) => ({
      id: key,
      name: char.name,
      actor: char.actor,
      czech_dubbing_actor: char.czech_dubbing_actor,
      personality: char.personality,
      languages: Object.keys(char.languages)
    }));
  }

  get(character_id) {
    return this.characters[character_id];
  }

  emotions() {
    return Object.entries(this.emotions_data).map(([key, emotion]) => ({
      id: key,
      label: emotion.label,
      description: emotion.description,
      intensity: emotion.intensity
    }));
  }

  getEmotion(emotion_id) {
    return this.emotions_data[emotion_id];
  }
}
