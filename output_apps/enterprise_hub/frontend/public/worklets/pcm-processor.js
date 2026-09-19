class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = (options && options.processorOptions && options.processorOptions.targetSampleRate) || 16000;
    this.inputSampleRate = sampleRate; // فرکانس ورودی بومی سافاری (معمولاً ۴۴.۱ یا ۴۸ کیلوهرتز)
    this.buffer = [];
    this.bufferSize = 2048;
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

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    const downsampled = this.downsample(channelData);
    for (let i = 0; i < downsampled.length; i++) {
      this.buffer.push(downsampled[i]);
    }

    while (this.buffer.length >= this.bufferSize) {
      const chunk = this.buffer.splice(0, this.bufferSize);
      const pcm16 = this.floatTo16BitPCM(Float32Array.from(chunk));
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
