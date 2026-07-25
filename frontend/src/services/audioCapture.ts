/**
 * Microphone capture and PCM16 conversion.
 *
 * Capture runs on an AudioWorklet when the browser supports one, so audio is
 * pulled on the audio thread instead of the main thread. `ScriptProcessorNode`
 * is deprecated and its callback competes with React rendering: with several
 * terminals streaming, that is exactly when dictation used to glitch. The old
 * path stays as a fallback because it is the only option on older engines.
 */

export const TARGET_SAMPLE_RATE = 16000

export type CaptureMode = 'worklet' | 'script-processor'

export interface PcmCaptureHandle {
  readonly mode: CaptureMode
  stop: () => void
}

export type FrameHandler = (frame: Float32Array, sampleRate: number) => void

const WORKLET_NAME = 'vibe-capture'
const WORKLET_SOURCE = `
class VibeCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && channel.length) {
      this.port.postMessage(new Float32Array(channel))
    }
    return true
  }
}
registerProcessor('${WORKLET_NAME}', VibeCaptureProcessor)
`

export function pcmBytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const stride = 0x8000
  for (let i = 0; i < bytes.length; i += stride) {
    binary += String.fromCharCode(...bytes.subarray(i, i + stride))
  }
  return btoa(binary)
}

/** Downsample to 16 kHz and pack as little-endian signed 16-bit PCM. */
export function floatToPcm16(input: Float32Array, inputSampleRate: number): Uint8Array {
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE
  const outputLength = Math.max(1, Math.floor(input.length / ratio))
  const bytes = new Uint8Array(outputLength * 2)
  const view = new DataView(bytes.buffer)

  for (let i = 0; i < outputLength; i++) {
    const sampleIndex = Math.min(input.length - 1, Math.floor(i * ratio))
    const sample = Math.max(-1, Math.min(1, input[sampleIndex] || 0))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }

  return bytes
}

export function rmsLevel(input: Float32Array): number {
  let total = 0
  for (const sample of input) total += sample * sample
  return Math.sqrt(total / Math.max(1, input.length))
}

async function startWorkletCapture(
  context: AudioContext,
  source: MediaStreamAudioSourceNode,
  onFrame: FrameHandler
): Promise<PcmCaptureHandle> {
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
  try {
    await context.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  const node = new AudioWorkletNode(context, WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
  })
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    onFrame(event.data, context.sampleRate)
  }
  source.connect(node)
  // The processor writes nothing to its output, so this connection only keeps
  // the node scheduled by the audio graph; it produces silence.
  node.connect(context.destination)
  return {
    mode: 'worklet',
    stop: () => {
      node.port.onmessage = null
      try {
        node.disconnect()
      } catch {
        // Already torn down with the context.
      }
      source.disconnect()
    },
  }
}

function startScriptProcessorCapture(
  context: AudioContext,
  source: MediaStreamAudioSourceNode,
  onFrame: FrameHandler
): PcmCaptureHandle {
  const processor = context.createScriptProcessor(4096, 1, 1)
  processor.onaudioprocess = (event) => {
    event.outputBuffer.getChannelData(0).fill(0)
    onFrame(event.inputBuffer.getChannelData(0), context.sampleRate)
  }
  source.connect(processor)
  processor.connect(context.destination)
  return {
    mode: 'script-processor',
    stop: () => {
      processor.onaudioprocess = null
      processor.disconnect()
      source.disconnect()
    },
  }
}

export async function startPcmCapture(
  context: AudioContext,
  source: MediaStreamAudioSourceNode,
  onFrame: FrameHandler
): Promise<PcmCaptureHandle> {
  if (typeof AudioWorkletNode === 'function' && context.audioWorklet) {
    try {
      return await startWorkletCapture(context, source, onFrame)
    } catch {
      // Fall through: an engine without worklet support must still dictate.
    }
  }
  return startScriptProcessorCapture(context, source, onFrame)
}
