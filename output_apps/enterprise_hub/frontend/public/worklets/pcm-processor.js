class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.buffer = [];
    this.bufferSize = 2048;

    this.isListening = false;
    this.isSpeaking = false;
    this.speakingFrames = 0;
    this.silenceFrames = 0;
    this.speechStartTimestamp = 0;

    // نگهداری فاز اعشاری جهت جلوگیری از افتادن نمونه‌ها و نویز تق‌تق
    this.phase = 0;

    // کالیبراسیون پویای نویز محیط (Adaptive Floor)
    this.noiseFloor = 0.004;
    this.calibrationFrames = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data && data.command === 'SET_LISTEN') {
        this.isListening = !!data.listening;
        this.isSpeaking = false;
        this.speakingFrames = 0;
        this.silenceFrames = 0;
        this.calibrationFrames = 0;
        this.buffer = [];
        this.phase = 0;
      }
    };
  }

  calculateRMS(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  process(inputs) {
    if (!this.isListening) return true;

    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    const rms = this.calculateRMS(channelData);

    // ۱. کالیبراسیون نویز در ۳۰۰ میلی‌ثانیه ابتدایی
    if (this.calibrationFrames < 35) {
      this.calibrationFrames++;
      this.noiseFloor = (this.noiseFloor * 0.85) + (rms * 0.15);
      return true;
    }

    const speechThreshold = Math.max(0.010, this.noiseFloor * 2.3);
    const silenceThreshold = Math.max(0.005, this.noiseFloor * 1.3);
    const silenceLimitFrames = Math.floor((sampleRate / 128) * 1.1); // ۱.۱ ثانیه مکث

    // ۲. تشخیص شروع کلام
    if (rms > speechThreshold) {
      this.speakingFrames++;
      this.silenceFrames = 0;
      if (!this.isSpeaking && this.speakingFrames >= 4) {
        this.isSpeaking = true;
        this.speechStartTimestamp = Date.now();
        this.port.postMessage({ event: 'SPEECH_START' });
      }
    } 
    // ۳. تشخیص سکوت و توقف خودکار
    else if (rms < silenceThreshold) {
      if (this.isSpeaking) {
        this.silenceFrames++;
        const duration = Date.now() - this.speechStartTimestamp;
        // پایان خودکار نوبت با مکث ۱.۱ ثانیه‌ای یا سقف ۸ ثانیه کلام ممتد
        if (this.silenceFrames >= silenceLimitFrames || duration > 8000) {
          this.isSpeaking = false;
          this.speakingFrames = 0;
          this.silenceFrames = 0;
          this.port.postMessage({ event: 'SPEECH_END' });
        }
      }
    }

    // ۴. تبدیل نرخ نمونه‌برداری ریاضی و پیوسته بدون از دست رفتن حتی ۱ سمپل
    const ratio = sampleRate / 16000;
    while (this.phase < channelData.length) {
      const idxLow = Math.floor(this.phase);
      const idxHigh = Math.min(idxLow + 1, channelData.length - 1);
      const frac = this.phase - idxLow;
      const sample = channelData[idxLow] * (1 - frac) + channelData[idxHigh] * frac;

      const s = Math.max(-1, Math.min(1, sample));
      const pcm16 = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.buffer.push(pcm16);

      this.phase += ratio;
    }
    this.phase -= channelData.length;

    while (this.buffer.length >= this.bufferSize) {
      const chunk = this.buffer.splice(0, this.bufferSize);
      const pcm16Array = new Int16Array(chunk);
      this.port.postMessage({ event: 'PCM_DATA', buffer: pcm16Array.buffer }, [pcm16Array.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
