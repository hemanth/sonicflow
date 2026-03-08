export async function decodeAudioBlob(blob, targetSampleRate) {
  const buffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    const decoded = await audioContext.decodeAudioData(buffer.slice(0));
    const mono = mergeToMono(decoded);

    if (decoded.sampleRate === targetSampleRate) {
      return mono.slice();
    }

    const frameCount = Math.ceil((mono.length * targetSampleRate) / decoded.sampleRate);
    const offlineContext = new OfflineAudioContext(1, frameCount, targetSampleRate);
    const sourceBuffer = offlineContext.createBuffer(1, mono.length, decoded.sampleRate);
    sourceBuffer.copyToChannel(mono, 0);

    const source = offlineContext.createBufferSource();
    source.buffer = sourceBuffer;
    source.connect(offlineContext.destination);
    source.start(0);

    const rendered = await offlineContext.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    await audioContext.close();
  }
}

export function mergeToMono(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);

  for (let channel = 0; channel < channels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      mono[index] += data[index] / channels;
    }
  }

  return mono;
}
