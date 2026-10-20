// Mic worklet for the live voice call: resamples to 16 kHz Int16 PCM and runs a small energy (RMS)
// VAD for turn-taking.
//
// Modes (port message {command:'SET_MODE', mode}):
//   'off'     - ignore the mic (assistant is thinking, call idle).
//   'listen'  - user's turn: stream PCM only once speech starts (with ~300 ms pre-roll) and emit
//               SPEECH_END after TRAILING_SILENCE_MS of silence (and at least MIN_SPEECH_MS of speech).
//   'monitor' - assistant is speaking: nothing is streamed; a much higher threshold (echo
//               protection) must be exceeded for BARGE_MS to emit BARGE_IN. The worklet then switches
//               itself to 'listen' with the speech onset already buffered, so no words are lost.
// Legacy {command:'SET_LISTEN', listening} is still accepted.
//
// Events posted: SPEECH_START, SPEECH_END, BARGE_IN, FLUSHED, PCM_DATA({buffer}).

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 2048;
const PRE_ROLL_SAMPLES = 4800; // 300 ms
const MONITOR_KEEP_SAMPLES = 9600; // 600 ms: covers BARGE_MS plus onset
const CALIBRATION_MS = 300;
const SPEECH_START_MS = 120; // voiced time needed to open a turn
const MIN_SPEECH_MS = 300; // shorter bursts (coughs, clicks) are discarded, not sent
const TRAILING_SILENCE_MS = 800; // end of turn
const MAX_UTTERANCE_MS = 20000;
const BARGE_MS = 250; // sustained voice over the assistant before we interrupt it
const BARGE_GRACE_MS = 350; // ignore the TTS onset transient right after monitor starts
const BARGE_MIN_RMS = 0.045; // far above the listen threshold: assistant echo must not trigger it

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = 'off';
    this.buffer = [];
    this.phase = 0;
    this.noiseFloor = 0.004;
    this.calibratedMs = 0;
    this.resetTurn();
    this.monitorMs = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;
      if (data.command === 'SET_MODE') {
        this.setMode(data.mode);
      } else if (data.command === 'SET_LISTEN') {
        this.setMode(data.listening ? 'listen' : 'off');
      } else if (data.command === 'FLUSH') {
        this.flush(true);
        this.port.postMessage({ event: 'FLUSHED' });
      }
    };
  }

  resetTurn() {
    this.isSpeaking = false;
    this.voicedMs = 0; // decaying voiced-time counter used to open a turn
    this.speechMs = 0; // total voiced time inside the turn
    this.silenceMs = 0;
    this.turnMs = 0;
    this.bargeMs = 0;
  }

  setMode(mode) {
    if (mode !== 'listen' && mode !== 'monitor') mode = 'off';
    this.mode = mode;
    this.resetTurn();
    this.monitorMs = 0;
    this.buffer = [];
    this.phase = 0;
  }

  rms(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  // Send buffered samples. `all` also sends a trailing partial chunk.
  flush(all) {
    while (this.buffer.length >= CHUNK_SAMPLES || (all && this.buffer.length > 0)) {
      const chunk = this.buffer.splice(0, CHUNK_SAMPLES);
      const pcm16 = new Int16Array(chunk);
      this.port.postMessage({ event: 'PCM_DATA', buffer: pcm16.buffer }, [pcm16.buffer]);
    }
  }

  process(inputs) {
    if (this.mode === 'off') return true;
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    const frameMs = (1000 * channelData.length) / sampleRate;
    const rms = this.rms(channelData);

    // Resample to 16 kHz Int16 continuously (fractional phase kept across frames).
    const ratio = sampleRate / TARGET_RATE;
    while (this.phase < channelData.length) {
      const idxLow = Math.floor(this.phase);
      const idxHigh = Math.min(idxLow + 1, channelData.length - 1);
      const frac = this.phase - idxLow;
      const sample = channelData[idxLow] * (1 - frac) + channelData[idxHigh] * frac;
      const s = Math.max(-1, Math.min(1, sample));
      this.buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      this.phase += ratio;
    }
    this.phase -= channelData.length;

    if (this.mode === 'monitor') {
      this.monitorMs += frameMs;
      // Rolling window only: nothing leaves the worklet while the assistant talks.
      if (this.buffer.length > MONITOR_KEEP_SAMPLES) {
        this.buffer.splice(0, this.buffer.length - MONITOR_KEEP_SAMPLES);
      }
      if (this.monitorMs < BARGE_GRACE_MS) return true;
      const bargeThreshold = Math.max(BARGE_MIN_RMS, this.noiseFloor * 6);
      if (rms > bargeThreshold) this.bargeMs += frameMs;
      else this.bargeMs = Math.max(0, this.bargeMs - frameMs * 2);
      if (this.bargeMs >= BARGE_MS) {
        // Hand over to 'listen' with the onset already buffered (isSpeaking = true).
        this.mode = 'listen';
        this.isSpeaking = true;
        this.voicedMs = SPEECH_START_MS;
        this.speechMs = this.bargeMs;
        this.silenceMs = 0;
        this.turnMs = this.bargeMs;
        this.bargeMs = 0;
        this.port.postMessage({ event: 'BARGE_IN' });
        this.flush(false);
      }
      return true;
    }

    // ---- listen mode ----
    if (this.calibratedMs < CALIBRATION_MS) {
      this.calibratedMs += frameMs;
      this.noiseFloor = this.noiseFloor * 0.85 + rms * 0.15;
      this.buffer = [];
      return true;
    }

    const speechThreshold = Math.max(0.012, this.noiseFloor * 2.5);
    const silenceThreshold = Math.max(0.007, this.noiseFloor * 1.6);

    if (!this.isSpeaking) {
      if (rms > speechThreshold) this.voicedMs += frameMs;
      else {
        this.voicedMs = Math.max(0, this.voicedMs - frameMs);
        // Adapt to the room only while nobody is talking.
        this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02;
      }
      if (this.voicedMs >= SPEECH_START_MS) {
        this.isSpeaking = true;
        this.speechMs = this.voicedMs;
        this.silenceMs = 0;
        this.turnMs = this.voicedMs;
        this.port.postMessage({ event: 'SPEECH_START' });
        this.flush(false);
      } else if (this.buffer.length > PRE_ROLL_SAMPLES) {
        this.buffer.splice(0, this.buffer.length - PRE_ROLL_SAMPLES); // keep only the pre-roll
      }
      return true;
    }

    // Speaking: stream and look for the end of the turn.
    this.turnMs += frameMs;
    if (rms > speechThreshold) {
      this.speechMs += frameMs;
      this.silenceMs = 0;
    } else if (rms < silenceThreshold) {
      this.silenceMs += frameMs;
    } else {
      this.silenceMs = Math.max(0, this.silenceMs - frameMs); // in-between: neither speech nor silence
    }
    this.flush(false);

    if (this.silenceMs >= TRAILING_SILENCE_MS || this.turnMs >= MAX_UTTERANCE_MS) {
      const enough = this.speechMs >= MIN_SPEECH_MS;
      if (enough) this.flush(true);
      this.resetTurn();
      this.buffer = [];
      // A discarded burst was already streamed in part: the client tells the server to drop it.
      this.port.postMessage({ event: enough ? 'SPEECH_END' : 'SPEECH_DISCARDED' });
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
