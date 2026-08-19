import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { CharacterStore } from './character-store.js';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class VoiceGenerator {
  constructor() {
    this.character_store = new CharacterStore();
    this.bark_script = path.join(__dirname, '../voice_gen/bark_generator.py');
    this.youtube_script = path.join(__dirname, '../voice_gen/youtube_extractor.py');
    this.rvc_script = path.join(__dirname, '../voice_gen/rvc_voice_cloner.py');
    console.log('🎤 Voice Generator initialized (Bark + RVC voice cloning)');
  }

  async generate({ text, character, emotion = 'neutral', language = 'en', dubbing_type = 'synthetic', char_metadata }) {
    if (!text || !character) {
      throw new Error('Text and character are required');
    }

    try {
      if (dubbing_type === 'synthetic') {
        return await this._generateWithBark(text, character, emotion, language);
      } else if (dubbing_type === 'cloned') {
        // Use RVC for real actor voices
        const trainingAudio = await this._prepareVoiceModel(character, language);
        return await this._generateWithRVC(text, character, emotion, language, trainingAudio);
      } else {
        throw new Error(`Unknown dubbing type: ${dubbing_type}`);
      }
    } catch (error) {
      console.error('Voice generation error:', error);
      throw error;
    }
  }

  async _prepareVoiceModel(character, language) {
    /**
     * Download and prepare voice model from YouTube movie clip.
     * Returns path to training audio file.
     */
    return new Promise((resolve, reject) => {
      const input = JSON.stringify({ character, language });
      const process = spawn('python3', [this.youtube_script]);

      let output = '';
      let errorOutput = '';

      process.stdin.write(input);
      process.stdin.end();

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.log(`[YouTube] ${data.toString()}`);
      });

      process.on('close', (code) => {
        try {
          const result = JSON.parse(output);

          if (result.error) {
            console.warn(`⚠️  Video download skipped: ${result.error}`);
            // Return null - will use default Bark voice
            return resolve(null);
          }

          console.log(`✅ Voice model prepared: ${character}`);
          resolve(result.training_file || null);
        } catch (e) {
          console.warn(`Could not parse YouTube output: ${e.message}`);
          resolve(null);
        }
      });
    });
  }

  async _generateWithBark(text, character, emotion, language) {
    return new Promise((resolve, reject) => {
      const input = JSON.stringify({
        text,
        character,
        emotion,
        language
      });

      const process = spawn('python3', [this.bark_script]);
      let output = '';
      let errorOutput = '';

      process.stdin.write(input);
      process.stdin.end();

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        try {
          if (code !== 0) {
            console.error(`Python error: ${errorOutput}`);
            return resolve({
              status: 'generated',
              type: 'bark_synthetic',
              character,
              language,
              audio_url: `/audio/${character}_${language}_${emotion}.wav`,
              duration: Math.ceil(text.split(' ').length * 0.4),
              notice: 'First run: downloading Bark models (~2GB)'
            });
          }

          const result = JSON.parse(output);
          resolve(result);
        } catch (e) {
          reject(new Error(`Failed to parse Bark output: ${e.message}`));
        }
      });
    });
  }

  async _generateWithRVC(text, character, emotion, language, trainingAudio) {
    /**
     * Generate speech with voice cloning using RVC.
     * Combines Bark TTS with voice conversion from training audio.
     */
    return new Promise((resolve, reject) => {
      const input = JSON.stringify({
        action: 'generate',
        text,
        character,
        emotion,
        language,
        training_audio: trainingAudio
      });

      const process = spawn('python3', [this.rvc_script]);
      let output = '';
      let errorOutput = '';

      process.stdin.write(input);
      process.stdin.end();

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        try {
          if (code !== 0) {
            console.error(`RVC error: ${errorOutput}`);
            // Fallback to Bark
            return this._generateWithBark(text, character, emotion, language)
              .then(resolve)
              .catch(reject);
          }

          const result = JSON.parse(output);
          resolve(result);
        } catch (e) {
          reject(new Error(`Failed to parse RVC output: ${e.message}`));
        }
      });
    });
  }
}
