class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = (options && options.processorOptions && options.processorOptions.targetSampleRate) || 16000;
    this.inputSampleRate = sampleRate;
    this.buffer = [];
    this.bufferSize = 2048;

    this.isListening = false;
    // آستانه متعادل و هوشمند برای تفکیک تنفس از کلام
    this.silenceThreshold = 0.0065;
    this.silenceFramesCount = 0;
    this.speakingFramesCount = 0;
    this.isSpeaking = false;
    // مکث مجاز ۱.۰ ثانیه‌ای برای ثبت پایان کلام طبیعی
    this.silenceLimit = Math.floor((this.inputSampleRate / 128) * 1.0);

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data && data.command === 'SET_LISTEN') {
        this.isListening = !!data.listening;
        this.isSpeaking = false;
        this.silenceFramesCount = 0;
        this.speakingFramesCount = 0;
        this.buffer = [];
      }
    };
  }

  downsample(input) {
    if (this.inputSampleRate === this.targetSampleRate) return input;
    const ratio = this.inputSampleRate / this.targetSampleRate;
    const outLength = Math.floor(input.length / ratio);
    const out = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const idx = i * ratio;
      const idxLow = Math.floor(idx);
      const idxHigh = Math.min(idxLow + 1, input.length - 1);
      const frac = idx - idxLow;
      out[i] = input[idxLow] * (1 - frac) + input[idxHigh] * frac;
    }
    return out;
  }

  floatTo16BitPCM(float32Array) {
    const out = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
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

    if (rms > this.silenceThreshold) {
      this.speakingFramesCount++;
      this.silenceFramesCount = 0;

      // احراز حداقل ۱۵ فریم کلام پیوسته (~۱۲۰ میلی‌ثانیه) جهت جلوگیری از تحریک با تنفس و ضربه
      if (!this.isSpeaking && this.speakingFramesCount >= 15) {
        this.isSpeaking = true;
        this.port.postMessage({ event: 'SPEECH_START' });
      }
    } else {
      if (this.isSpeaking) {
        this.silenceFramesCount++;
        // تشخیص قطعی پایان جمله
        if (this.silenceFramesCount >= this.silenceLimit) {
          this.isSpeaking = false;
          this.speakingFramesCount = 0;
          this.silenceFramesCount = 0;
          this.port.postMessage({ event: 'SPEECH_END' });
        }
      }
    }

    const downsampled = this.downsample(channelData);
    for (let i = 0; i < downsampled.length; i++) {
      this.buffer.push(downsampled[i]);
    }

    while (this.buffer.length >= this.bufferSize) {
      const chunk = this.buffer.splice(0, this.bufferSize);
      const pcm16 = this.floatTo16BitPCM(Float32Array.from(chunk));
      this.port.postMessage({ event: 'PCM_DATA', buffer: pcm16.buffer }, [pcm16.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
