import axios from 'axios';
import { CharacterStore } from './character-store.js';

export class VoiceGenerator {
  constructor() {
    this.higgsfields_api = process.env.HIGGSFIELDS_API_URL || 'https://api.higgsfields.com';
    this.api_key = process.env.HIGGSFIELDS_API_KEY;
    this.character_store = new CharacterStore();

    if (!this.api_key) {
      console.warn('⚠️  HIGGSFIELDS_API_KEY not set. Voice generation will be mocked.');
    }
  }

  async generate({ text, character, emotion = 'neutral', language = 'en', dubbing_type = 'synthetic', char_metadata }) {
    const emotion_data = this.character_store.getEmotion(emotion);
    const voice_config = this._buildVoiceConfig(character, language, dubbing_type, char_metadata);

    // Build prompt with emotion
    const prompt = this._buildPrompt(text, emotion, emotion_data, char_metadata);

    try {
      if (dubbing_type === 'synthetic') {
        return await this._generateSynthetic(prompt, voice_config, text);
      } else if (dubbing_type === 'cloned') {
        return await this._generateCloned(prompt, voice_config, text, character, language);
      } else {
        throw new Error(`Unknown dubbing type: ${dubbing_type}`);
      }
    } catch (error) {
      console.error('Voice generation error:', error);
      throw error;
    }
  }

  _buildVoiceConfig(character, language, dubbing_type, char_metadata) {
    const char_lang = char_metadata.languages[language];

    return {
      character,
      language,
      dubbing_type,
      voice_id: char_lang.voice_id,
      personality: char_metadata.personality,
      voice_traits: char_metadata.voice_traits,
      actor: language === 'en' ? char_metadata.actor : char_metadata.czech_dubbing_actor
    };
  }

  _buildPrompt(text, emotion, emotion_data, char_metadata) {
    const base = `You are voice talent for character "${char_metadata.name}". Personality: ${char_metadata.personality}. Speak naturally as this character.`;

    if (emotion !== 'neutral' && emotion_data.prompt_modifier) {
      return `${base}\n\nEmotional delivery: ${emotion_data.prompt_modifier}\n\nText to speak: "${text}"`;
    }

    return `${base}\n\nText to speak: "${text}"`;
  }

  async _generateSynthetic(prompt, voice_config, text) {
    // Mock implementation for MVP
    // In production, this would call Higgsfields generate_audio with voice model + prompt

    console.log(`🎤 Synthetic generation: ${voice_config.character} (${voice_config.language})`);
    console.log(`📝 Text: ${text}`);
    console.log(`💭 Emotion: ${voice_config.emotion}`);

    // Simulated response
    return {
      status: 'generated',
      type: 'synthetic',
      character: voice_config.character,
      language: voice_config.language,
      audio_url: `https://mock-audio.local/synthetic/${voice_config.character}_${voice_config.language}.mp3`,
      duration: Math.ceil(text.split(' ').length * 0.4),
      mood: 'mock'
    };
  }

  async _generateCloned(prompt, voice_config, text, character, language) {
    // Mock implementation for MVP
    // In production, this would use voice clone via create_voice_from_confirmed_audio + generate_audio

    console.log(`🎭 Cloned generation: ${character} (${language})`);
    console.log(`📝 Text: ${text}`);
    console.log(`🎬 Actor: ${voice_config.actor}`);

    // Simulated response
    return {
      status: 'generated',
      type: 'cloned',
      character: voice_config.character,
      language: voice_config.language,
      actor: voice_config.actor,
      audio_url: `https://mock-audio.local/cloned/${character}_${language}_${voice_config.actor}.mp3`,
      duration: Math.ceil(text.split(' ').length * 0.4),
      voice_model: `clone_${character}_${language}`
    };
  }
}
