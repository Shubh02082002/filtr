'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, Search, FileText, MessageSquare, Layers, ChevronDown, ChevronUp, Loader2, CheckCircle, AlertCircle, X, Zap, ThumbsUp, ThumbsDown, Info } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const FEEDBACK_FORM_URL = 'https://forms.gle/W3UCpN3GWmEWJFbz8'
const QUERY_CAP = 4

type SourceType = 'slack' | 'jira' | 'transcript'

interface Source {
  text: string
  source_file: string
  source_type: SourceType
  score: number
  author?: string
  timestamp?: string
  issue_type?: string
}

interface QueryResult {
  answer: string
  sources: Source[]
  query: string
  queries_remaining?: number
}

interface FileResult {
  file: string
  chunks: number
  warning?: string
}

interface Cluster {
  cluster_idx: number
  count: number
  excerpts: string[]
  sources: { slack: number; jira: number; transcript: number }
  name: string
}

const SOURCE_COLORS: Record<SourceType, string> = {
  slack: 'bg-purple-900/40 border-purple-700/50 text-purple-300',
  jira: 'bg-blue-900/40 border-blue-700/50 text-blue-300',
  transcript: 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300',
}

const SOURCE_ICONS: Record<SourceType, React.ReactNode> = {
  slack: <MessageSquare size={12} />,
  jira: <Layers size={12} />,
  transcript: <FileText size={12} />,
}

function SourceChip({ type }: { type: SourceType }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${SOURCE_COLORS[type] || 'bg-gray-800 border-gray-700 text-gray-300'}`}>
      {SOURCE_ICONS[type]}
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </span>
  )
}

function SourceCard({ source }: { source: Source }) {
  const [expanded, setExpanded] = useState(false)
  const preview = source.text.length > 120 ? source.text.slice(0, 120) + '...' : source.text

  return (
    <div className="bg-[#1a1d27] border border-[#2a2d3d] rounded-lg p-3 hover:border-[#3a3f55] transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <SourceChip type={source.source_type as SourceType} />
          <span className="text-xs text-gray-500 truncate max-w-[200px]">{source.source_file}</span>
        </div>
        <span className="text-xs text-gray-600 shrink-0">score: {source.score}</span>
      </div>
      <p className="text-sm text-gray-300 leading-relaxed">
        "{expanded ? source.text : preview}"
      </p>
      {source.text.length > 120 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
        >
          {expanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show more</>}
        </button>
      )}
    </div>
  )
}

// ── Compact Cluster Tab (replaces full ClusterCard) ──
function ClusterTab({ cluster }: { cluster: Cluster }) {
  const [vote, setVote] = useState<'up' | 'down' | null>(null)
  const total = cluster.sources.slack + cluster.sources.jira + cluster.sources.transcript

  return (
    <div className="flex items-center justify-between bg-[#141720] border border-[#2a2d3d] rounded-lg px-3 py-2 hover:border-[#3a3f55] transition-colors gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-medium text-slate-200 truncate">{cluster.name}</span>
        <span className="text-xs text-slate-500 shrink-0">{cluster.count} mentions</span>
        <div className="flex gap-1 shrink-0">
          {cluster.sources.slack > 0 && (
            <span className="text-xs bg-purple-900/40 text-purple-300 border border-purple-700/50 px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">
              <MessageSquare size={9} /> {cluster.sources.slack}
            </span>
          )}
          {cluster.sources.jira > 0 && (
            <span className="text-xs bg-blue-900/40 text-blue-300 border border-blue-700/50 px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">
              <Layers size={9} /> {cluster.sources.jira}
            </span>
          )}
          {cluster.sources.transcript > 0 && (
            <span className="text-xs bg-emerald-900/40 text-emerald-300 border border-emerald-700/50 px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">
              <FileText size={9} /> {cluster.sources.transcript}
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-1 shrink-0">
        <button
          onClick={() => setVote('up')}
          className={`p-1 rounded transition-colors ${vote === 'up' ? 'text-emerald-400' : 'text-gray-600 hover:text-emerald-400'}`}
        >
          <ThumbsUp size={11} />
        </button>
        <button
          onClick={() => setVote('down')}
          className={`p-1 rounded transition-colors ${vote === 'down' ? 'text-red-400' : 'text-gray-600 hover:text-red-400'}`}
        >
          <ThumbsDown size={11} />
        </button>
      </div>
    </div>
  )
}

// ── Query Counter ──
function QueryCounter({ used, cap }: { used: number; cap: number }) {
  const remaining = cap - used
  const pct = (used / cap) * 100
  const color = remaining === 0 ? 'text-red-400' : remaining === 1 ? 'text-amber-400' : 'text-indigo-400'

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {Array.from({ length: cap }).map((_, i) => (
          <div
            key={i}
            className={`w-1.5 h-1.5 rounded-full transition-colors ${i < used ? 'bg-indigo-500' : 'bg-[#2a2d3d]'}`}
          />
        ))}
      </div>
      <span className={`text-xs font-medium ${color}`}>
        {remaining === 0 ? 'No questions left' : `${remaining} of ${cap} questions remaining`}
      </span>
      <div className="relative group">
        <Info size={12} className="text-gray-600 cursor-help" />
        <div className="absolute bottom-5 right-0 w-56 bg-[#1e2130] border border-[#2a2d3d] rounded-lg p-3 text-xs text-gray-400 hidden group-hover:block z-10 shadow-xl">
          <p className="font-medium text-gray-300 mb-1">MVP Free Tier Limit</p>
          <p>Each session allows {cap} questions to manage API usage during beta. Upload new files to start a fresh session.</p>
        </div>
      </div>
    </div>
  )
}

// ── Stage config ──
const STAGES = [
  { key: 'uploaded',   label: 'Uploaded' },
  { key: 'indexed',    label: 'Indexed' },
  { key: 'clustering', label: 'Clustering' },
  { key: 'ready',      label: 'Ready' },
] as const

type StageKey = typeof STAGES[number]['key']

const STAGE_STATUS_LINES: Record<StageKey, (chunks: number) => string> = {
  uploaded:   ()       => 'Uploading your files...',
  indexed:    ()       => 'Embedding & indexing your data...',
  clustering: (chunks) => `Finding patterns across ${chunks} chunks...`,
  ready:      ()       => 'Naming your top themes...',
}

const MILESTONE_POSITIONS = [0, 33, 66, 100]

const SAMPLE_QUERIES = [
  'What are the most common issues users report?',
  'What bugs are blocking users from completing checkout?',
  'What features are users requesting most?',
  'What onboarding problems are users experiencing?',
]

// ── Milestone Progress Bar ──
function MilestoneBar({ stageIndex, fillPct }: { stageIndex: number; fillPct: number }) {
  return (
    <div className="relative w-full" style={{ height: '28px' }}>
      <div className="absolute rounded-full" style={{ height: '2px', top: '50%', transform: 'translateY(-50%)', left: '0', right: '0', background: '#1e2130' }} />
      <div
        className="absolute rounded-full transition-all duration-1000 ease-out"
        style={{ height: '2px', top: '50%', transform: 'translateY(-50%)', left: '0', width: `${fillPct}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)', boxShadow: '0 0 6px rgba(99,102,241,0.5)' }}
      />
      {MILESTONE_POSITIONS.map((pos, i) => {
        const isComplete = i < stageIndex
        const isActive = i === stageIndex
        return (
          <div key={i} className="absolute transition-all duration-500" style={{ left: `${pos}%`, top: '50%', transform: 'translate(-50%, -50%)' }}>
            {isActive && (
              <div className="absolute rounded-full animate-ping" style={{ width: '16px', height: '16px', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(99,102,241,0.25)' }} />
            )}
            <div
              className="relative rounded-full transition-all duration-500"
              style={{
                width: isActive ? '10px' : '8px',
                height: isActive ? '10px' : '8px',
                background: isComplete ? '#6366f1' : isActive ? '#a5b4fc' : '#1e2130',
                border: isActive ? '2px solid #6366f1' : isComplete ? 'none' : '2px solid #374151',
                boxShadow: isActive ? '0 0 10px rgba(99,102,241,0.8)' : 'none',
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

// ── Sticky Bottom Feedback Bar ──
function BottomFeedbackBar() {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-3 border-t border-[#2a2d3d]"
      style={{ background: 'rgba(20, 23, 32, 0.95)', backdropFilter: 'blur(12px)' }}
    >
      <span className="text-sm text-gray-400">Did Filtr save you time today?</span>
      <div className="flex items-center gap-3">
        <a href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer" onClick={() => setDismissed(true)}
          className="text-sm font-medium px-4 py-1.5 rounded-lg bg-emerald-700/30 text-emerald-400 border border-emerald-700/50 hover:bg-emerald-700/50 transition-colors">
          Yes, it did
        </a>
        <a href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer" onClick={() => setDismissed(true)}
          className="text-sm font-medium px-4 py-1.5 rounded-lg bg-[#1e2130] text-gray-400 border border-[#2a2d3d] hover:border-[#3a3f55] hover:text-gray-300 transition-colors">
          Not really
        </a>
        <button onClick={() => setDismissed(true)} className="text-gray-600 hover:text-gray-400 transition-colors ml-1">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

export default function Home() {
  const [step, setStep] = useState<'upload' | 'loading' | 'query'>('upload')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState<FileResult[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [querying, setQuerying] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [showSources, setShowSources] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [insights, setInsights] = useState<Cluster[]>([])
  const [currentStage, setCurrentStage] = useState<StageKey>('uploaded')
  const [countdown, setCountdown] = useState(60)
  const [fillPct, setFillPct] = useState(0)
  const [queriesUsed, setQueriesUsed] = useState(0)
  const [capReached, setCapReached] = useState(false)

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fillRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const totalChunks = uploadResults.reduce((a, r) => a + r.chunks, 0)

  const startCountdown = (from: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setCountdown(from)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(countdownRef.current!); return 1 }
        return prev - 1
      })
    }, 1000)
  }

  const stopCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    if (fillRef.current) clearInterval(fillRef.current)
  }

  const crawlFill = (targetPct: number, stepSize = 0.4, intervalMs = 80) => {
    if (fillRef.current) clearInterval(fillRef.current)
    fillRef.current = setInterval(() => {
      setFillPct(prev => {
        if (prev >= targetPct) { clearInterval(fillRef.current!); return targetPct }
        return Math.min(prev + stepSize, targetPct)
      })
    }, intervalMs)
  }

  useEffect(() => () => stopCountdown(), [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    setFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)])
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles(prev => [...prev, ...Array.from(e.target.files!)])
  }

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleUpload = async () => {
    if (!files.length) return
    setUploading(true)
    setUploadError(null)
    setCurrentStage('uploaded')
    setFillPct(0)
    setQueriesUsed(0)
    setCapReached(false)
    startCountdown(60)
    setStep('loading')
    setInsights([])
    crawlFill(28)

    const formData = new FormData()
    files.forEach(f => formData.append('files', f))

    try {
      await fetch(`${API_BASE}/health`).catch(() => {})
      await new Promise(resolve => setTimeout(resolve, 3000))

      setCurrentStage('indexed')
      setFillPct(33)
      startCountdown(40)
      crawlFill(58)

      const res = await fetch(`${API_BASE}/ingest`, { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Upload failed')
      }
      const data = await res.json()
      setSessionId(data.session_id)
      setUploadResults(data.files)

      setCurrentStage('clustering')
      setFillPct(66)
      startCountdown(25)
      crawlFill(88)

      const sid = data.session_id

      setTimeout(() => {
        setCurrentStage('ready')
        setFillPct(90)
        startCountdown(10)
        crawlFill(96)
      }, 15000)

      setTimeout(() => {
        fetch(`${API_BASE}/insights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sid, n_clusters: 5 }),
        })
          .then(r => r.json())
          .then(d => { setInsights(d.clusters || []) })
          .catch(() => setInsights([]))
          .finally(() => {
            stopCountdown()
            setFillPct(100)
            setTimeout(() => setStep('query'), 400)
          })
      }, 2000)

    } catch (err: any) {
      setUploadError(err.message)
      stopCountdown()
      setStep('upload')
    } finally {
      setUploading(false)
    }
  }

  const handleQuery = async (q?: string) => {
    const queryText = q || query
    if (!queryText.trim() || !sessionId || capReached) return
    setQuerying(true)
    setQueryError(null)
    setResult(null)
    if (q) setQuery(q)

    try {
      const res = await fetch(`${API_BASE}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryText, session_id: sessionId }),
      })
      if (!res.ok) {
        const err = await res.json()
        if (err.detail?.includes('QUERY_CAP_REACHED')) {
          setCapReached(true)
          setQueriesUsed(QUERY_CAP)
          return
        }
        throw new Error(err.detail || 'Query failed')
      }
      const data = await res.json()
      setResult(data)
      setQueriesUsed(prev => {
        const next = prev + 1
        if (next >= QUERY_CAP) setCapReached(true)
        return next
      })
    } catch (err: any) {
      setQueryError(err.message)
    } finally {
      setQuerying(false)
    }
  }

  const stageIndex = STAGES.findIndex(s => s.key === currentStage)

  return (
    <div className="min-h-screen bg-[#0f1117]">

      {/* Header */}
      <header className="border-b border-[#1e2130] bg-[#0f1117]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Zap size={14} className="text-white" />
            </div>
            <span className="font-semibold text-white text-lg">Filtr</span>
            <span className="text-xs bg-indigo-900/50 text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-800/50 ml-1">Beta</span>
          </div>

          {step === 'query' && (
            <div className="flex items-center gap-3">
              <a href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer"
                className="text-xs font-medium px-3 py-1.5 rounded-full border border-indigo-700/60 text-indigo-400 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-all">
                Share Feedback
              </a>
              <button
                onClick={() => {
                  setStep('upload')
                  setFiles([])
                  setUploadResults([])
                  setResult(null)
                  setSessionId(null)
                  setInsights([])
                  setQueriesUsed(0)
                  setCapReached(false)
                  stopCountdown()
                }}
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Back to upload
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12 pb-20">

        {/* ── UPLOAD STEP ── */}
        {step === 'upload' && (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-10">
              <h1 className="text-3xl font-bold text-white mb-3">What are users actually saying?</h1>
              <p className="text-gray-400 text-lg">
                Upload your Slack export, Jira CSV, or call transcripts.<br />
                Ask questions in plain English. Get sourced answers in seconds.
              </p>
            </div>

            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                dragOver ? 'border-indigo-500 bg-indigo-900/10' : 'border-[#2a2d3d] hover:border-[#3a3f55] bg-[#141720]'
              }`}
            >
              <Upload size={32} className="mx-auto mb-3 text-indigo-400" />
              <p className="text-white font-medium mb-1">Drop files here or click to browse</p>
              <p className="text-gray-500 text-sm">Slack JSON · Jira CSV · Transcripts PDF/TXT · Max 10MB per file</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".json,.csv,.pdf,.txt"
                onChange={handleFileSelect}
                style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0, overflow: 'hidden' }}
              />
            </div>

            {files.length > 0 && (
              <div className="mt-4 space-y-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between bg-[#141720] border border-[#2a2d3d] rounded-lg px-4 py-2">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-indigo-400" />
                      <span className="text-sm text-gray-300">{f.name}</span>
                      <span className="text-xs text-gray-600">({(f.size / 1024).toFixed(0)} KB)</span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); removeFile(i) }} className="text-gray-600 hover:text-red-400 transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-center text-gray-600 text-sm mt-4">
              No data? Try with our{' '}
              <a href="/mock_data/slack_export_mock.json" download className="text-indigo-400 hover:text-indigo-300 underline">Slack</a>,{' '}
              <a href="/mock_data/jira_export_mock.csv" className="text-indigo-400 hover:text-indigo-300 underline">Jira</a>,{' '}
              <a href="/mock_data/transcript_mock.txt" download className="text-indigo-400 hover:text-indigo-300 underline">Transcript</a>{' '}
              mock files
            </p>

            {uploadError && (
              <div className="mt-4 flex items-center gap-2 bg-red-900/20 border border-red-800/50 rounded-lg px-4 py-3 text-red-400 text-sm">
                <AlertCircle size={16} /> {uploadError}
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!files.length || uploading}
              className="mt-6 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {uploading
                ? <><Loader2 size={18} className="animate-spin" /> Indexing your data...</>
                : <><Zap size={18} /> Analyse My Data</>
              }
            </button>
            <p className="text-center text-gray-500 text-xs mt-2">First load may take 30 seconds while the server wakes up.</p>
          </div>
        )}

        {/* ── LOADING STEP ── */}
        {step === 'loading' && (
          <div className="max-w-md mx-auto mt-24">
            <div className="text-center mb-12">
              <p className="text-xs text-gray-600 uppercase tracking-widest mb-4">Analysing Your Data</p>
              <p className="text-3xl font-light text-white tabular-nums">~{countdown}s remaining</p>
            </div>
            <div className="mb-3 px-1">
              <MilestoneBar stageIndex={stageIndex} fillPct={fillPct} />
            </div>
            <div className="relative mb-10" style={{ height: '20px' }}>
              {STAGES.map((s, i) => {
                const isComplete = i < stageIndex
                const isActive = i === stageIndex
                const pos = MILESTONE_POSITIONS[i]
                return (
                  <span key={s.key} className="absolute text-xs uppercase tracking-wide transition-colors duration-500"
                    style={{
                      left: `${pos}%`,
                      transform: i === 0 ? 'translateX(0)' : i === STAGES.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                      color: isComplete ? '#6366f1' : isActive ? '#ffffff' : '#374151',
                      fontWeight: isActive ? '600' : '400',
                    }}>
                    {s.label}
                  </span>
                )
              })}
            </div>
            <p className="text-center text-sm text-gray-600 mb-6">
              {STAGE_STATUS_LINES[currentStage](totalChunks)}
            </p>
            {currentStage === 'uploaded' && (
              <div className="mx-auto max-w-sm bg-[#141720] border border-[#2a2d3d] rounded-lg px-4 py-3 text-center">
                <p className="text-xs text-amber-500/80 leading-relaxed">
                  ⏳ <span className="font-medium">First load takes 30–60s</span> — our server sleeps when idle and needs a moment to wake up. Subsequent sessions will be significantly faster.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── QUERY STEP ── */}
        {step === 'query' && (
          <div>
            {/* Upload summary */}
            <div className="bg-[#141720] border border-[#2a2d3d] rounded-xl p-4 mb-6 flex flex-wrap gap-3 items-center">
              <CheckCircle size={16} className="text-emerald-400 shrink-0" />
              <span className="text-sm text-gray-300 font-medium">Data indexed</span>
              {uploadResults.map((r, i) => (
                <span key={i} className="text-xs bg-[#1e2130] border border-[#2a2d3d] rounded-full px-3 py-1 text-gray-400">
                  {r.file} <span className="text-indigo-400">{r.chunks} chunks</span>
                </span>
              ))}
            </div>

            {/* Compact cluster tabs */}
            {insights.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Zap size={14} className="text-indigo-400" />
                  <h2 className="text-sm font-semibold text-indigo-400 uppercase tracking-wide">Top Issues This Period</h2>
                  <span className="text-xs text-gray-600 ml-1">auto-detected from your data</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {insights.map((cluster, i) => (
                    <ClusterTab key={i} cluster={cluster} />
                  ))}
                </div>
                <div className="mt-4 h-px bg-[#2a2d3d]" />
              </div>
            )}

            {/* Query input + counter */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-400">Ask a question</span>
                <QueryCounter used={queriesUsed} cap={QUERY_CAP} />
              </div>

              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
                    placeholder={capReached ? 'Query limit reached — restart to continue' : 'What are the most common issues users report?'}
                    disabled={capReached}
                    className="w-full bg-[#141720] border border-[#2a2d3d] rounded-xl pl-10 pr-4 py-3.5 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                </div>
                <button
                  onClick={() => handleQuery()}
                  disabled={!query.trim() || querying || capReached}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-6 rounded-xl transition-colors flex items-center gap-2 shrink-0"
                >
                  {querying ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                  Ask
                </button>
              </div>

              {!capReached && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {SAMPLE_QUERIES.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleQuery(q)}
                      disabled={capReached}
                      className="text-xs text-gray-400 hover:text-indigo-300 bg-[#141720] border border-[#2a2d3d] hover:border-indigo-800/50 rounded-full px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Cap reached banner */}
            {capReached && (
              <div className="flex items-start gap-3 bg-amber-900/20 border border-amber-800/50 rounded-xl px-4 py-4 mb-6">
                <AlertCircle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-400 mb-1">You've used all {QUERY_CAP} free questions</p>
                  <p className="text-xs text-amber-600">This limit exists during the MVP beta to manage API usage. Click "Back to upload" to start a fresh session with new files.</p>
                </div>
              </div>
            )}

            {querying && (
              <div className="flex items-center gap-3 text-gray-400 py-8 justify-center">
                <Loader2 size={20} className="animate-spin text-indigo-400" />
                <span>Searching your data and generating answer...</span>
              </div>
            )}

            {queryError && (
              <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm mb-4 ${
                queryError.includes('cooling down')
                  ? 'bg-blue-900/20 border border-blue-800/50 text-blue-400'
                  : 'bg-red-900/20 border border-red-800/50 text-red-400'
              }`}>
                <AlertCircle size={16} />
                {queryError.includes('cooling down')
                  ? '⏳ System is busy — all API keys are cooling down. Wait 60 seconds and try again.'
                  : queryError}
              </div>
            )}

            {result && !querying && (
              <div className="space-y-6">
                <div className="bg-[#141720] border border-[#2a2d3d] rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Zap size={14} className="text-indigo-400" />
                    <span className="text-xs text-indigo-400 font-medium uppercase tracking-wide">AI Answer</span>
                  </div>
                  <div className="text-gray-200 leading-relaxed whitespace-pre-wrap text-sm">
                    {result.answer}
                  </div>
                </div>

                <div>
                  <button
                    onClick={() => setShowSources(!showSources)}
                    className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-3"
                  >
                    {showSources ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    Source chunks ({result.sources.length})
                  </button>
                  {showSources && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {result.sources.map((source, i) => (
                        <SourceCard key={i} source={source} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      <footer className="border-t border-[#1e2130] mt-20 py-6 text-center text-xs text-gray-700">
        Filtr · Files processed in-memory and not stored after indexing · Built with Gemini + GroQ + Pinecone
      </footer>

      {step === 'query' && <BottomFeedbackBar />}

    </div>
  )
}