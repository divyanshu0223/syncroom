// Test WAV header and PCM math
function audioBufferToWavArrayBuffer(channelDataLeft: Float32Array, channelDataRight: Float32Array, sampleRate: number) {
  const numOfChan = 2;
  const numSamples = channelDataLeft.length;
  const length = numSamples * numOfChan * 2 + 44;
  const outBuffer = new ArrayBuffer(length);
  const view = new DataView(outBuffer);

  function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(view, 0, 'RIFF');
  view.setUint32(4, length - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2 * numOfChan, true);
  view.setUint16(32, numOfChan * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length - 44, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    let sL = Math.max(-1, Math.min(1, channelDataLeft[i]));
    view.setInt16(offset, sL < 0 ? sL * 32768 : sL * 32767, true);
    offset += 2;

    let sR = Math.max(-1, Math.min(1, channelDataRight[i]));
    view.setInt16(offset, sR < 0 ? sR * 32768 : sR * 32767, true);
    offset += 2;
  }

  return outBuffer;
}

const left = new Float32Array(100);
const right = new Float32Array(100);
const buf = audioBufferToWavArrayBuffer(left, right, 44100);
console.log('Buffer bytes:', buf.byteLength, 'Expected:', 100 * 2 * 2 + 44);
