class Capture extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (input) {
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++)
        pcm[i] = Math.max(-1, Math.min(1, input[i])) * 32767;
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    for (const output of outputs) for (const channel of output) channel.fill(0);
    return true;
  }
}
registerProcessor("pcm-capture", Capture);
