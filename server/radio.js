// Text radio between the humans currently connected to this server.
//
// This is genuinely live — it is real people typing to each other — but it is
// NOT air traffic control. Nothing here is generated; if nobody types, it stays
// empty, and that empty state is the honest one.

class RadioSystem {
  constructor(maxPerChannel = 100) {
    this.channels = new Map(); // channel key -> messages[]
    this.maxPerChannel = maxPerChannel;
  }

  transmit({ callsign, role, channel, text }) {
    const msg = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      callsign: String(callsign || 'UNKNOWN').slice(0, 16),
      role: role === 'atc' ? 'atc' : 'pilot',
      channel: String(channel),
      text: String(text).slice(0, 500),
      timestamp: Date.now(),
      kind: 'user', // never 'atc-live' — this server does not receive ATC text
    };

    const list = this.channels.get(msg.channel) || [];
    list.push(msg);
    if (list.length > this.maxPerChannel) list.shift();
    this.channels.set(msg.channel, list);

    return msg;
  }

  history(channel, limit = 30) {
    return (this.channels.get(String(channel)) || []).slice(-limit);
  }
}

module.exports = RadioSystem;
