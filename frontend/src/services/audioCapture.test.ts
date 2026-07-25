import { describe, expect, it } from 'vitest'
import { floatToPcm16, pcmBytesToBase64, rmsLevel, TARGET_SAMPLE_RATE } from './audioCapture'

function readSamples(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Array.from({ length: bytes.length / 2 }, (_, index) => view.getInt16(index * 2, true))
}

describe('floatToPcm16', () => {
  it('keeps the sample count when already at the target rate', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1])

    const bytes = floatToPcm16(input, TARGET_SAMPLE_RATE)

    expect(bytes.length).toBe(input.length * 2)
    expect(readSamples(bytes)).toEqual([0, 16383, -16384, 32767])
  })

  it('downsamples a 48 kHz frame by three', () => {
    const input = new Float32Array(300).fill(0.25)

    const bytes = floatToPcm16(input, 48000)

    expect(bytes.length / 2).toBe(100)
  })

  it('clamps samples outside the [-1, 1] range', () => {
    const bytes = floatToPcm16(new Float32Array([5, -5]), TARGET_SAMPLE_RATE)

    expect(readSamples(bytes)).toEqual([32767, -32768])
  })

  it('never produces an empty buffer for a tiny frame', () => {
    expect(floatToPcm16(new Float32Array([0.1]), 48000).length).toBe(2)
  })
})

describe('rmsLevel', () => {
  it('is zero for silence', () => {
    expect(rmsLevel(new Float32Array(128))).toBe(0)
  })

  it('matches the amplitude of a constant signal', () => {
    expect(rmsLevel(new Float32Array(64).fill(0.5))).toBeCloseTo(0.5, 6)
  })

  it('does not divide by zero on an empty frame', () => {
    expect(rmsLevel(new Float32Array(0))).toBe(0)
  })
})

describe('pcmBytesToBase64', () => {
  it('round-trips through atob', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])

    const decoded = atob(pcmBytesToBase64(bytes))

    expect(Array.from(decoded, (char) => char.charCodeAt(0))).toEqual(Array.from(bytes))
  })

  it('handles buffers larger than the chunking stride', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 5).fill(7)

    expect(atob(pcmBytesToBase64(bytes)).length).toBe(bytes.length)
  })
})
