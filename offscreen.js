let audioContext = null;

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'play-bell-offscreen') {
    return;
  }

  playBellTone().catch((error) => {
    console.error('Bell playback failed:', error);
  });
});

async function playBellTone() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  const start = audioContext.currentTime + 0.02;
  ring(start, 987.77, 0.9, 0.26);
  ring(start + 0.06, 1318.51, 1.1, 0.2);
  ring(start + 0.14, 1567.98, 1.3, 0.14);
}

function ring(start, frequency, decay, gainAmount) {
  const carrier = audioContext.createOscillator();
  const overtone = audioContext.createOscillator();
  const gain = audioContext.createGain();

  carrier.type = 'sine';
  carrier.frequency.setValueAtTime(frequency, start);
  carrier.frequency.exponentialRampToValueAtTime(frequency * 0.997, start + decay);

  overtone.type = 'triangle';
  overtone.frequency.setValueAtTime(frequency * 2.01, start);
  overtone.frequency.exponentialRampToValueAtTime(frequency * 1.98, start + decay);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainAmount, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);

  carrier.connect(gain);
  overtone.connect(gain);
  gain.connect(audioContext.destination);

  carrier.start(start);
  overtone.start(start);
  carrier.stop(start + decay + 0.05);
  overtone.stop(start + decay + 0.05);
}
