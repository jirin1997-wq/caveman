// Live ATC communication feed simulator with realistic patterns
// In production, this would connect to actual ATC data sources

class ATCFeed {
  constructor() {
    this.messages = [];
    this.pilots = new Map();
    this.startRealisticTransmissions();
  }

  startRealisticTransmissions() {
    // Simulate realistic ATC communications every 5-15 seconds
    const generateTransmission = () => {
      const delay = 5000 + Math.random() * 10000;

      setTimeout(() => {
        this.generateRealisticATC();
        generateTransmission();
      }, delay);
    };

    generateTransmission();
  }

  generateRealisticATC() {
    const callsigns = ['CSA100', 'CSA101', 'KLM456', 'LH789', 'BA100', 'AF456', 'SQ200', 'AA500'];
    const frequencies = [118.1, 121.9, 121.85, 120.1, 120.5];

    const atcResponses = [
      'Roger, continue approach',
      'Cleared to land runway 06 left',
      'Descend and maintain 5000 feet',
      'Turn left heading 090',
      'Reduce speed to 250 knots',
      'Contact ground on 121.9',
      'Confirm runway 24 right',
      'Wind 360 at 8 knots',
      'Expedite descent',
      'Say your position',
      'Cross FIX at 3000 feet',
      'Traffic 2 o\'clock 5 miles same altitude',
      'Squawk 1234',
      'Ident',
      'Resume own navigation'
    ];

    const pilotRequests = [
      'Prague Approach, CSA100 requesting descent to 6000 feet',
      'Tower, CSA100 ready for takeoff runway 06 left',
      'Ground, CSA100 pushing back from stand',
      'Approach, requesting vectors for approach to LKPR',
      'Tower, CSA100 on final approach runway 24 right',
      'Mayday, Mayday, engine failure',
      'Roger that, commencing approach',
      'Request holding pattern',
      'Requesting permission to climb to 8000 feet',
      'Standing by'
    ];

    const callsign = callsigns[Math.floor(Math.random() * callsigns.length)];
    const frequency = frequencies[Math.floor(Math.random() * frequencies.length)];
    const isTower = Math.random() > 0.5;

    const text = isTower
      ? `Tower: ${atcResponses[Math.floor(Math.random() * atcResponses.length)]}`
      : `${callsign}: ${pilotRequests[Math.floor(Math.random() * pilotRequests.length)]}`;

    const message = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      callsign: isTower ? 'Prague Tower' : callsign,
      role: isTower ? 'atc' : 'pilot',
      frequency,
      text,
      timestamp: Date.now(),
      duration: Math.ceil(text.split(' ').length / 3)
    };

    this.messages.push(message);

    // Keep last 50 messages
    if (this.messages.length > 50) {
      this.messages.shift();
    }

    return message;
  }

  getMessages(limit = 20) {
    return this.messages.slice(-limit);
  }

  getMessagesByFrequency(frequency, limit = 20) {
    return this.messages.filter(m => m.frequency === frequency).slice(-limit);
  }
}

module.exports = ATCFeed;
