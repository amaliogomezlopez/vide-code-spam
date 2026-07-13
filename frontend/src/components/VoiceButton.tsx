import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioWebSocket, type AudioMessage } from '../services/websocket'
import { fetchSttStatus, sendText, type SttStatus } from '../services/api'
import { sendToTerminal } from '../services/terminalInput'
import { useAgentStore } from '../stores/agentStore'
import { useDebugStore } from '../stores/debugStore'
import Icon from './Icon'

const TARGET_SAMPLE_RATE = 16000
const PCM_CHUNK_MS = 250
const PCM_CHUNK_BYTES = Math.round((TARGET_SAMPLE_RATE * PCM_CHUNK_MS * 2) / 1000)
const AUTO_STOP_SILENCE_MS = 1200
const MIN_RECORDING_MS = 650
const VOICE_RMS_THRESHOLD = 0.012

function pcmBytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const stride = 0x8000
  for (let i = 0; i < bytes.length; i += stride) {
    binary += String.fromCharCode(...bytes.subarray(i, i + stride))
  }
  return btoa(binary)
}

function floatToPcm16(input: Float32Array, inputSampleRate: number): Uint8Array {
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

function rmsLevel(input: Float32Array): number {
  let total = 0
  for (const sample of input) total += sample * sample
  return Math.sqrt(total / Math.max(1, input.length))
}

export default function VoiceButton() {
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const pendingPcmRef = useRef<Uint8Array[]>([])
  const pendingPcmBytesRef = useRef(0)
  const flushPcmRef = useRef<(() => void) | null>(null)
  const transcribingTimeoutRef = useRef<number | null>(null)
  const lastVoiceAtRef = useRef<number>(0)
  const recordingStartedAtRef = useRef<number>(0)
  const overlayUpdatedAtRef = useRef<number>(0)
  const latencyMarksRef = useRef<Record<string, number>>({})
  const wsRef = useRef<AudioWebSocket | null>(null)
  const selectedAgentRef = useRef<string | null>(null)
  const modeRef = useRef<'terminal' | 'global'>('terminal')
  const recordingRef = useRef(false)
  const transcribingRef = useRef(false)
  const sttReadyRef = useRef(false)
  const [sttInfo, setSttInfo] = useState<SttStatus | null>(null)
  const [status, setStatus] = useState('Preparing speech model')
  const selectedAgent = useAgentStore((s) => s.selectedAgent)
  const addDebug = useDebugStore((s) => s.add)

  selectedAgentRef.current = selectedAgent
  recordingRef.current = recording
  transcribingRef.current = transcribing

  const stopRecording = useCallback(() => {
    if (!recordingRef.current) return
    latencyMarksRef.current.stopRequested = performance.now()
    addDebug('voice', `stop requested (${modeRef.current})`)

    flushPcmRef.current?.()
    wsRef.current?.stopRecording()
    latencyMarksRef.current.stopSent = performance.now()

    processorRef.current?.disconnect()
    processorRef.current = null
    sourceRef.current?.disconnect()
    sourceRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    flushPcmRef.current = null
    recordingRef.current = false
    setRecording(false)
    transcribingRef.current = true
    setTranscribing(true)
    setStatus('Transcribing')
    addDebug(
      'latency',
      `capture ${(latencyMarksRef.current.stopSent - latencyMarksRef.current.recordingStarted).toFixed(0)}ms`
    )
    if (modeRef.current === 'global') {
      void window.electronAPI?.updateDictationOverlay?.({
        mode: 'transcribing',
        level: 0.35,
      })
    }
    if (transcribingTimeoutRef.current !== null) {
      clearTimeout(transcribingTimeoutRef.current)
    }
    transcribingTimeoutRef.current = window.setTimeout(() => {
      transcribingRef.current = false
      setTranscribing(false)
      setStatus('Transcription timed out')
      addDebug('stt', 'timeout waiting for transcription', 'error')
      if (modeRef.current === 'global') {
        void window.electronAPI?.updateDictationOverlay?.({
          mode: 'error',
          level: 0.12,
        })
      }
    }, 45000)
  }, [addDebug])

  const startRecording = useCallback(
    async (mode: 'terminal' | 'global' = 'terminal') => {
      if (recordingRef.current || transcribingRef.current) return
      if (!sttReadyRef.current) {
        try {
          const info = await fetchSttStatus()
          setSttInfo(info)
          sttReadyRef.current = info.ready
        } catch {
          sttReadyRef.current = false
        }
        if (!sttReadyRef.current) {
          setStatus('Preparing speech model…')
          addDebug('stt', 'dictation blocked until model warmup completes', 'warn')
          if (mode === 'global') {
            void window.electronAPI?.updateDictationOverlay?.({
              mode: 'transcribing',
              level: 0.18,
              text: 'Preparing speech model…',
            })
          }
          return
        }
      }
      const target = selectedAgentRef.current
      if (mode === 'terminal' && !target) {
        setStatus('Select a terminal first')
        return
      }
      modeRef.current = mode
      try {
        latencyMarksRef.current = { startRequested: performance.now() }
        addDebug('voice', `start requested (${mode})`)
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        latencyMarksRef.current.micReady = performance.now()
        streamRef.current = stream
        const audioContext = new AudioContext()
        const source = audioContext.createMediaStreamSource(stream)
        const processor = audioContext.createScriptProcessor(4096, 1, 1)
        audioContextRef.current = audioContext
        sourceRef.current = source
        processorRef.current = processor
        pendingPcmRef.current = []
        pendingPcmBytesRef.current = 0
        overlayUpdatedAtRef.current = 0
        recordingStartedAtRef.current = Date.now()
        lastVoiceAtRef.current = Date.now()

        const flushPcm = () => {
          if (pendingPcmBytesRef.current <= 0) return
          const joined = new Uint8Array(pendingPcmBytesRef.current)
          let offset = 0
          for (const chunk of pendingPcmRef.current) {
            joined.set(chunk, offset)
            offset += chunk.length
          }
          pendingPcmRef.current = []
          pendingPcmBytesRef.current = 0
          wsRef.current?.sendAudio(pcmBytesToBase64(joined))
          if (!latencyMarksRef.current.firstChunkSent) {
            latencyMarksRef.current.firstChunkSent = performance.now()
            addDebug(
              'latency',
              `first pcm chunk ${(latencyMarksRef.current.firstChunkSent - latencyMarksRef.current.recordingStarted).toFixed(0)}ms`
            )
          }
        }
        flushPcmRef.current = flushPcm
        wsRef.current?.startRecording('pcm_s16le', TARGET_SAMPLE_RATE, 1)

        processor.onaudioprocess = (event) => {
          const input = event.inputBuffer.getChannelData(0)
          const output = event.outputBuffer.getChannelData(0)
          output.fill(0)

          const rms = rmsLevel(input)
          const level = Math.min(1, rms * 12)
          const now = Date.now()
          if (rms > VOICE_RMS_THRESHOLD) {
            lastVoiceAtRef.current = now
          }

          if (modeRef.current === 'global' && now - overlayUpdatedAtRef.current > 75) {
            overlayUpdatedAtRef.current = now
            void window.electronAPI?.updateDictationOverlay?.({
              mode: 'listening',
              level,
            })
          }

          const pcm = floatToPcm16(input, audioContext.sampleRate)
          pendingPcmRef.current.push(pcm)
          pendingPcmBytesRef.current += pcm.length
          if (pendingPcmBytesRef.current >= PCM_CHUNK_BYTES) flushPcm()

          if (
            modeRef.current === 'global' &&
            recordingRef.current &&
            now - recordingStartedAtRef.current > MIN_RECORDING_MS &&
            now - lastVoiceAtRef.current > AUTO_STOP_SILENCE_MS
          ) {
            addDebug('voice', `auto-stop after ${AUTO_STOP_SILENCE_MS}ms silence`)
            stopRecording()
            return
          }
        }

        source.connect(processor)
        processor.connect(audioContext.destination)
        recordingRef.current = true
        latencyMarksRef.current.recordingStarted = performance.now()
        setRecording(true)
        setStatus(mode === 'global' ? 'Global listening' : 'Listening')
        addDebug(
          'latency',
          `mic ${(latencyMarksRef.current.micReady - latencyMarksRef.current.startRequested).toFixed(0)}ms`
        )
        if (mode === 'global') {
          void window.electronAPI?.updateDictationOverlay?.({
            mode: 'listening',
            level: 0.16,
          })
        }
      } catch (err) {
        processorRef.current?.disconnect()
        processorRef.current = null
        sourceRef.current?.disconnect()
        sourceRef.current = null
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        void audioContextRef.current?.close()
        audioContextRef.current = null
        console.error('Microphone access denied or not available', err)
        addDebug('voice', err instanceof Error ? err.message : 'microphone unavailable', 'error')
        setStatus('Mic unavailable')
        if (mode === 'global') {
          void window.electronAPI?.updateDictationOverlay?.({
            mode: 'error',
            level: 0.12,
          })
        }
      }
    },
    [addDebug, stopRecording]
  )

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | null = null
    const refreshStatus = async () => {
      try {
        const info = await fetchSttStatus(controller.signal)
        setSttInfo(info)
        const becameReady = info.ready && !sttReadyRef.current
        sttReadyRef.current = info.ready
        if (info.ready && !recordingRef.current && !transcribingRef.current) {
          setStatus(
            `${info.device ?? info.provider ?? 'STT'} · ${info.model ?? 'ready'}`
          )
          if (becameReady) {
            void window.electronAPI?.updateDictationOverlay?.({
              mode: 'idle',
              level: 0.1,
              text: 'Dictation ready',
            })
          }
        } else if (!info.ready && !recordingRef.current && !transcribingRef.current) {
          setStatus(info.state === 'error' ? 'Speech model unavailable' : 'Preparing speech model…')
        }
      } catch {
        sttReadyRef.current = false
      }
      if (!controller.signal.aborted) timer = window.setTimeout(refreshStatus, 1000)
    }
    void refreshStatus()
    return () => {
      controller.abort()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const ws = new AudioWebSocket(
      (msg: AudioMessage) => {
        addDebug('ws', msg.type)
        if (msg.type === 'transcription') {
          latencyMarksRef.current.transcriptionReceived = performance.now()
          if (transcribingTimeoutRef.current !== null) {
            clearTimeout(transcribingTimeoutRef.current)
            transcribingTimeoutRef.current = null
          }
          transcribingRef.current = false
          setTranscribing(false)
          const text = (msg.cleaned || msg.raw).trim()
          const timings = msg.timings
          if (timings) {
            addDebug(
              'latency',
              `backend decode ${(Number(timings.decode_s || 0) * 1000).toFixed(0)}ms, stt ${(Number(timings.stt_s || 0) * 1000).toFixed(0)}ms, format ${(Number(timings.format_s || 0) * 1000).toFixed(0)}ms`
            )
          }
          if (latencyMarksRef.current.stopSent) {
            addDebug(
              'latency',
              `post-stop ${(latencyMarksRef.current.transcriptionReceived - latencyMarksRef.current.stopSent).toFixed(0)}ms`
            )
          }
          const target = selectedAgentRef.current
          const mode = modeRef.current
          if (!text) {
            setStatus('No speech detected')
            if (mode === 'global') {
              void window.electronAPI?.updateDictationOverlay?.({
                mode: 'idle',
                level: 0.1,
              })
            }
            return
          }
          if (mode === 'global') {
            const insert = window.electronAPI?.insertGlobalDictationText
            if (!insert) {
              setStatus('Global paste unavailable')
              addDebug('paste', 'global paste is unavailable on this platform', 'error')
              void window.electronAPI?.updateDictationOverlay?.({
                mode: 'error',
                level: 0.12,
              })
              return
            }
            void insert(text)
              .then((inserted) => {
                setStatus(inserted ? 'Pasted in focused app' : 'Paste failed; text is on clipboard')
                addDebug(
                  'paste',
                  inserted ? `inserted ${text.length} chars` : 'helper did not confirm insertion',
                  inserted ? 'info' : 'error'
                )
                void window.electronAPI?.updateDictationOverlay?.({
                  mode: inserted ? 'idle' : 'error',
                  level: inserted ? 0.1 : 0.12,
                })
              })
              .catch((err) => {
                console.error(err)
                setStatus('Paste failed; text is on clipboard')
                addDebug('paste', err instanceof Error ? err.message : 'paste failed', 'error')
                void window.electronAPI?.updateDictationOverlay?.({
                  mode: 'error',
                  level: 0.12,
                })
              })
            return
          }
          if (!target) {
            setStatus('Select a terminal first')
            return
          }
          const delivered = sendToTerminal(target, text)
          if (!delivered) {
            sendText(target, text).catch(console.error)
          }
          setStatus(delivered ? 'Inserted in terminal' : 'Sent as line')
        }
        if (msg.type === 'transcription_error') {
          if (transcribingTimeoutRef.current !== null) {
            clearTimeout(transcribingTimeoutRef.current)
            transcribingTimeoutRef.current = null
          }
          transcribingRef.current = false
          setTranscribing(false)
          setStatus('Transcription failed')
          addDebug('stt', msg.message, 'error')
          if (modeRef.current === 'global') {
            void window.electronAPI?.updateDictationOverlay?.({
              mode: 'error',
              level: 0.12,
            })
          }
        }
      },
      '/ws/audio',
      () => {
        addDebug('ws', 'audio socket closed', 'warn')
        if (transcribingRef.current) {
          transcribingRef.current = false
          setTranscribing(false)
          setStatus('Audio socket closed')
          if (modeRef.current === 'global') {
            void window.electronAPI?.updateDictationOverlay?.({
              mode: 'error',
              level: 0.12,
            })
          }
        }
      }
    )
    wsRef.current = ws

    let unsubscribe: (() => void) | undefined
    if (window.electronAPI?.onGlobalPushToTalk) {
      unsubscribe = window.electronAPI.onGlobalPushToTalk((state) => {
        if (state === 'start') startRecording('terminal')
        if (state === 'stop') stopRecording()
        if (state === 'toggle') {
          if (recordingRef.current && modeRef.current === 'terminal') stopRecording()
          else if (recordingRef.current) return
          else startRecording('terminal')
        }
      })
    }
    const unsubscribeGlobal = window.electronAPI?.onGlobalDictation?.((state) => {
      if (state === 'start') startRecording('global')
      if (state === 'stop') stopRecording()
      if (state === 'toggle') {
        if (recordingRef.current && modeRef.current === 'global') stopRecording()
        else if (recordingRef.current) return
        else startRecording('global')
      }
    })

    return () => {
      ws.close()
      unsubscribe?.()
      unsubscribeGlobal?.()
      if (transcribingTimeoutRef.current !== null) clearTimeout(transcribingTimeoutRef.current)
    }
  }, [addDebug, startRecording, stopRecording])

  const label = recording ? 'Stop dictation' : transcribing ? 'Transcribing' : 'Push to talk'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
      <button
        className={`voice-button${recording ? ' recording' : ''}${transcribing ? ' transcribing' : ''}`}
        onMouseDown={() => startRecording('terminal')}
        onMouseUp={stopRecording}
        onMouseLeave={stopRecording}
        onTouchStart={() => startRecording('terminal')}
        onTouchEnd={stopRecording}
        disabled={transcribing || !sttInfo?.ready}
        title="Hold the button, or press the configured global shortcut to toggle dictation."
      >
        {recording ? (
          <>
            <span className="voice-rec-dot" />
            Listening
          </>
        ) : transcribing ? (
          <>
            <span className="spinner" />
            Transcribing
          </>
        ) : (
          <>
            <Icon name="mic" />
            Dictate
          </>
        )}
      </button>
      <span className="voice-note">{label === 'Push to talk' ? status : label}</span>
    </div>
  )
}
