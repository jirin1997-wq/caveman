class VoiceCharacterEmulator {
  constructor() {
    this.characters = [];
    this.emotions = [];
    this.currentResult = null;

    this.init();
  }

  async init() {
    await this.loadCharacters();
    await this.loadEmotions();
    this.setupEventListeners();
  }

  async loadCharacters() {
    try {
      const response = await fetch('/api/characters');
      this.characters = await response.json();
      this.renderCharacterGrids();
    } catch (error) {
      this.showError('Failed to load characters');
      console.error(error);
    }
  }

  async loadEmotions() {
    try {
      const response = await fetch('/api/emotions');
      this.emotions = await response.json();
      this.renderEmotionSelects();
    } catch (error) {
      this.showError('Failed to load emotions');
      console.error(error);
    }
  }

  renderCharacterGrids() {
    const synthGrid = document.getElementById('synthetic-characters');
    const clonedGrid = document.getElementById('cloned-characters');

    const createCharacterOption = (char, tabType) => {
      const div = document.createElement('div');
      div.className = 'character-option';
      div.innerHTML = `
        <div class="character-name">${char.name}</div>
        <div class="character-actor">${tabType === 'synthetic' ? char.actor : char.czech_dubbing_actor}</div>
      `;
      div.onclick = () => {
        document.getElementById(`${tabType}-character`).value = char.id;
        // Visual feedback
        document.querySelectorAll(`#${tabType}-characters .character-option`).forEach(el => {
          el.style.borderColor = '#ddd';
          el.style.background = '#f8f9fa';
        });
        div.style.borderColor = '#667eea';
        div.style.background = '#f0f2ff';
      };
      return div;
    };

    this.characters.forEach(char => {
      synthGrid.appendChild(createCharacterOption(char, 'synthetic'));
      clonedGrid.appendChild(createCharacterOption(char, 'cloned'));
    });

    // Select first character by default
    if (this.characters.length > 0) {
      document.getElementById('synthetic-character').value = this.characters[0].id;
      document.getElementById('cloned-character').value = this.characters[0].id;
      synthGrid.querySelector('.character-option').style.borderColor = '#667eea';
      synthGrid.querySelector('.character-option').style.background = '#f0f2ff';
      clonedGrid.querySelector('.character-option').style.borderColor = '#667eea';
      clonedGrid.querySelector('.character-option').style.background = '#f0f2ff';
    }
  }

  renderEmotionSelects() {
    const synthEmotion = document.getElementById('synthetic-emotion');
    const clonedEmotion = document.getElementById('cloned-emotion');

    this.emotions.forEach(emotion => {
      const option = document.createElement('option');
      option.value = emotion.id;
      option.textContent = emotion.label;
      synthEmotion.appendChild(option.cloneNode(true));
      clonedEmotion.appendChild(option);
    });
  }

  setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Form submissions
    document.getElementById('synthForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.generateVoice('synthetic');
    });

    document.getElementById('clonedForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.generateVoice('cloned');
    });

    // Download button
    document.getElementById('downloadBtn').addEventListener('click', () => {
      if (this.currentResult?.audio_url) {
        const a = document.createElement('a');
        a.href = this.currentResult.audio_url;
        a.download = `${this.currentResult.character}_${this.currentResult.language}.mp3`;
        a.click();
      }
    });
  }

  switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');

    // Hide result when switching tabs
    document.getElementById('result').classList.remove('show');
  }

  async generateVoice(type) {
    const characterId = document.getElementById(`${type}-character`).value;
    const language = document.getElementById(`${type}-language`).value;
    const emotion = document.getElementById(`${type}-emotion`).value;
    const text = document.getElementById(`${type}-text`).value;

    if (!characterId || !text.trim()) {
      this.showError('Please select a character and enter text');
      return;
    }

    this.showLoading(true);
    this.hideError();

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          character: characterId,
          emotion,
          language,
          dubbing_type: type === 'cloned' ? 'cloned' : 'synthetic'
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Generation failed');
      }

      const result = await response.json();
      this.displayResult(result);
    } catch (error) {
      this.showError(error.message);
      console.error(error);
    } finally {
      this.showLoading(false);
    }
  }

  displayResult(result) {
    this.currentResult = result;

    const languageLabels = { en: '🇬🇧 English', cs: '🇨🇿 Čeština' };
    const typeLabels = { synthetic: '🤖 Synthetic', cloned: '🎬 Dubbed' };

    const charName = this.characters.find(c => c.id === result.character)?.name || result.character;

    document.getElementById('result-character').textContent = charName;
    document.getElementById('result-type').textContent = typeLabels[result.type] || result.type;
    document.getElementById('result-language').textContent = languageLabels[result.language] || result.language;
    document.getElementById('result-duration').textContent = `${result.duration}s`;

    const audio = document.getElementById('result-audio');
    audio.src = result.audio_url;

    document.getElementById('result').classList.add('show');
  }

  showLoading(show) {
    const loader = document.getElementById('loading');
    if (show) {
      loader.classList.add('show');
    } else {
      loader.classList.remove('show');
    }
  }

  showError(message) {
    const errorEl = document.getElementById('error');
    errorEl.textContent = message;
    errorEl.classList.add('show');
  }

  hideError() {
    document.getElementById('error').classList.remove('show');
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  window.emulator = new VoiceCharacterEmulator();
});
