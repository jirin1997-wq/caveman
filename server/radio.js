class RadioSystem {
  constructor(frequencies) {
    this.frequencies = frequencies;
    this.channels = new Map();
    this.callsigns = new Set();

    // Initialize channels for each frequency
    Object.entries(frequencies).forEach(([name, freq]) => {
      this.channels.set(freq, {
        name,
        frequency: freq,
        messages: [],
        activeCallsigns: new Set()
      });
    });
  }

  transmit(callsign, frequency, text) {
    const channel = this.channels.get(frequency);
    if (!channel) return null;

    // Parse message (callsign might include role like "pilot" or "atc")
    const [actualCallsign, role = 'pilot'] = callsign.split(':');

    const message = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      callsign: actualCallsign,
      role, // 'pilot' or 'atc'
      frequency,
      text,
      timestamp: Date.now(),
      duration: this.estimateSpeechDuration(text)
    };

    channel.messages.push(message);
    channel.activeCallsigns.add(actualCallsign);

    // Keep last 50 messages per frequency
    if (channel.messages.length > 50) {
      channel.messages.shift();
    }

    return message;
  }

  getChannelMessages(frequency, limit = 20) {
    const channel = this.channels.get(frequency);
    if (!channel) return [];

    return channel.messages.slice(-limit);
  }

  getAllChannels() {
    return Array.from(this.channels.values()).map(ch => ({
      name: ch.name,
      frequency: ch.frequency,
      messageCount: ch.messages.length,
      activeCallsigns: Array.from(ch.activeCallsigns),
      recentMessages: ch.messages.slice(-5)
    }));
  }

  estimateSpeechDuration(text) {
    // Rough estimate: ~150 words per minute = 2.5 words per second
    const words = text.split(' ').length;
    return Math.max(2, Math.ceil(words / 2.5)); // min 2 seconds
  }

  registerCallsign(callsign) {
    this.callsigns.add(callsign);
  }

  getActiveCallsigns() {
    return Array.from(this.callsigns);
  }
}

module.exports = RadioSystem;
