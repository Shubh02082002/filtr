'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, Search, FileText, MessageSquare, Layers, ChevronDown, ChevronUp, Loader2, CheckCircle, AlertCircle, X, Zap, Info, Sun, Moon } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const FEEDBACK_FORM_URL = 'https://forms.gle/W3UCpN3GWmEWJFbz8'
const QUERY_CAP = 4

type SourceType = 'slack' | 'jira' | 'transcript'
type Theme = 'dark' | 'light'

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

// ── Gradients ──
const DARK_BG = `
  radial-gradient(ellipse at 20% 20%, rgba(79,70,229,0.18) 0%, transparent 50%),
  radial-gradient(ellipse at 80% 80%, rgba(109,40,217,0.12) 0%, transparent 50%),
  linear-gradient(135deg, #06080f 0%, #080b18 40%, #06091a 70%, #06080f 100%)
`
const LIGHT_BG = `
  radial-gradient(ellipse at 0% 0%, #ede8ff 0%, rgba(237,232,255,0) 55%),
  radial-gradient(ellipse at 100% 100%, #f0ebff 0%, rgba(240,235,255,0) 50%),
  linear-gradient(135deg, #ded1fc 0%, #f9f9fa 40%, #f9f9fa 70%, #ded1fc 100%)
`

// ── Theme tokens ──
const THEME = {
  dark: {
    bgCard: '#0d1020',
    border: '#1c2035',
    text: '#ffffff',
    textMuted: '#c3c6cb',
    textFaint: '#d3dbe2',
    accentText: '#818cf8',
    headerBg: 'rgba(6,8,15,0.85)',
    pillBg: '#0d1020',
    inputBg: '#0d1020',
    footerBorder: '#1c2035',
    footerText: '#f5f6f8',
    warningBg: 'rgba(245,158,11,0.08)',
    warningBorder: 'rgba(245,158,11,0.25)',
    warningText: '#fbbf24',
    progressDone: '#6366f1',
    progressRemain: '#1c2035',
    toggleIcon: '#ffffff',
  },
  light: {
    bgCard: '#ffffff',
    border: '#E0E0E0',
    text: '#1A1A1A',
    textMuted: '#302f2f',
    textFaint: '#464444',
    accentText: '#7A4CFF',
    headerBg: 'rgba(255,255,255,0.85)',
    pillBg: '#F3F0FF',
    inputBg: '#ffffff',
    footerBorder: '#E0E0E0',
    footerText: '#7d7b7b',
    warningBg: '#FFF5E6',
    warningBorder: '#f6c89a',
    warningText: '#D35400',
    progressDone: '#7A4CFF',
    progressRemain: '#E0E0E0',
    toggleIcon: '#000000',
  }
}

// Light theme source chip colors per spec
const SOURCE_COLORS_DARK: Record<SourceType, { bg: string; border: string; text: string }> = {
  slack: { bg: 'rgba(139,92,246,0.2)', border: 'rgba(139,92,246,0.4)', text: '#c4b5fd' },
  jira: { bg: 'rgba(59,130,246,0.2)', border: 'rgba(59,130,246,0.4)', text: '#93c5fd' },
  transcript: { bg: 'rgba(16,185,129,0.2)', border: 'rgba(16,185,129,0.4)', text: '#6ee7b7' },
}
const SOURCE_COLORS_LIGHT: Record<SourceType, { bg: string; border: string; text: string }> = {
  slack: { bg: '#E6E0FF', border: '#c4b5fd', text: '#4B0082' },
  jira: { bg: '#E1F5FE', border: '#90caf9', text: '#01579B' },
  transcript: { bg: '#E0F2F1', border: '#80cbc4', text: '#00695C' },
}

const SOURCE_ICONS: Record<SourceType, React.ReactNode> = {
  slack: <MessageSquare size={9} />,
  jira: <Layers size={9} />,
  transcript: <FileText size={9} />,
}

function SourceChip({ type, theme }: { type: SourceType; theme: Theme }) {
  const colors = theme === 'dark' ? SOURCE_COLORS_DARK[type] : SOURCE_COLORS_LIGHT[type]
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium border"
      style={{ background: colors.bg, borderColor: colors.border, color: colors.text, fontSize: '0.65rem' }}>
      {SOURCE_ICONS[type]}
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </span>
  )
}

function SourceCard({ source, theme }: { source: Source; theme: Theme }) {
  const [expanded, setExpanded] = useState(false)
  const t = THEME[theme]
  const preview = source.text.length > 120 ? source.text.slice(0, 120) + '...' : source.text
  return (
    <div className="rounded-lg p-2 transition-colors" style={{ background: t.bgCard, border: `1px solid ${t.border}` }}>
      <div className="flex items-start justify-between gap-1.5 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <SourceChip type={source.source_type as SourceType} theme={theme} />
          <span className="truncate max-w-[150px]" style={{ color: t.textFaint, fontSize: '0.65rem' }}>{source.source_file}</span>
        </div>
        <span className="shrink-0" style={{ color: t.textFaint, fontSize: '0.65rem' }}>score: {source.score}</span>
      </div>
      <p className="leading-relaxed" style={{ color: t.textMuted, fontSize: '0.7rem' }}>"{expanded ? source.text : preview}"</p>
      {source.text.length > 120 && (
        <button onClick={() => setExpanded(!expanded)} className="mt-1 flex items-center gap-1 hover:opacity-70" style={{ fontSize: '0.65rem', color: t.accentText }}>
          {expanded ? <><ChevronUp size={9} /> Show less</> : <><ChevronDown size={9} /> Show more</>}
        </button>
      )}
    </div>
  )
}

function ClusterTab({ cluster, theme, onSelect }: { cluster: Cluster; theme: Theme; onSelect: (name: string) => void }) {
  const t = THEME[theme]
  const sc = theme === 'dark' ? SOURCE_COLORS_DARK : SOURCE_COLORS_LIGHT
  return (
    <div onClick={() => onSelect(cluster.name)} className="flex items-center justify-between rounded-lg px-3 py-2 transition-colors gap-3 cursor-pointer hover:opacity-80" style={{ background: t.bgCard, border: `1px solid ${t.border}` }}>
      {/* Left — cluster name */}
      <span className="font-medium truncate flex-1" style={{ color: t.text, fontSize: '0.7rem' }}>{cluster.name}</span>
      {/* Middle — mention count */}
      <span className="shrink-0" style={{ color: t.textFaint, fontSize: '0.7rem' }}>{cluster.count} mentions</span>
      {/* Right — source pills */}
      <div className="flex gap-1 shrink-0">
        {cluster.sources.slack > 0 && (
          <span className="font-medium px-2 py-0.5 rounded-full border" style={{ background: sc.slack.bg, borderColor: sc.slack.border, color: sc.slack.text, fontSize: '0.65rem' }}>
            Slack {cluster.sources.slack}
          </span>
        )}
        {cluster.sources.jira > 0 && (
          <span className="font-medium px-2 py-0.5 rounded-full border" style={{ background: sc.jira.bg, borderColor: sc.jira.border, color: sc.jira.text, fontSize: '0.65rem' }}>
            Jira {cluster.sources.jira}
          </span>
        )}
        {cluster.sources.transcript > 0 && (
          <span className="font-medium px-2 py-0.5 rounded-full border" style={{ background: sc.transcript.bg, borderColor: sc.transcript.border, color: sc.transcript.text, fontSize: '0.65rem' }}>
            Transcript {cluster.sources.transcript}
          </span>
        )}
      </div>
    </div>
  )
}

function QueryCounter({ used, cap, theme }: { used: number; cap: number; theme: Theme }) {
  const remaining = cap - used
  const t = THEME[theme]
  const color = remaining === 0 ? '#f87171' : remaining === 1 ? '#fbbf24' : t.accentText
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-1">
        {Array.from({ length: cap }).map((_, i) => (
          <div key={i} className="w-1 h-1 rounded-full transition-colors" style={{ background: i < used ? t.progressDone : t.progressRemain }} />
        ))}
      </div>
      <span className="font-medium" style={{ color, fontSize: '0.65rem' }}>
        {remaining === 0 ? 'No questions left' : `${remaining} of ${cap} questions remaining`}
      </span>
      <div className="relative group">
        <Info size={9} className="cursor-help" style={{ color: t.textFaint }} />
        <div className="absolute bottom-4 right-0 w-44 rounded-lg p-2 hidden group-hover:block z-10 shadow-xl" style={{ background: t.bgCard, border: `1px solid ${t.border}`, color: t.textMuted, fontSize: '0.65rem' }}>
          <p className="font-medium mb-1" style={{ color: t.text }}>MVP Free Tier Limit</p>
          <p>Each session allows {cap} questions during beta. Upload new files to start a fresh session.</p>
        </div>
      </div>
    </div>
  )
}
const STAGES = [
  { key: 'uploading', label: 'Uploading' },
  { key: 'indexing', label: 'Indexing' },
  { key: 'clustering', label: 'Clustering' },
  { key: 'ready', label: 'Ready' },
] as const

type StageKey = typeof STAGES[number]['key']

const STAGE_STATUS_LINES: Record<StageKey, (chunks: number) => string> = {
  uploading: () => 'Uploading your files...',
  indexing: () => 'Embedding & indexing your data...',
  clustering: (chunks) => `Finding patterns across ${chunks} chunks...`,
  ready: () => 'Naming your top themes...',
}

const MILESTONE_POSITIONS = [0, 33, 66, 100]

function MilestoneBar({ stageIndex, fillPct, theme }: { stageIndex: number; fillPct: number; theme: Theme }) {
  const t = THEME[theme]
  return (
    <div className="relative w-full" style={{ height: '24px' }}>
      <div className="absolute rounded-full" style={{ height: '2px', top: '50%', transform: 'translateY(-50%)', left: 0, right: 0, background: t.progressRemain }} />
      <div className="absolute rounded-full transition-all duration-1000 ease-out" style={{ height: '2px', top: '50%', transform: 'translateY(-50%)', left: 0, width: `${fillPct}%`, background: `linear-gradient(90deg,${t.progressDone},#8b5cf6)`, boxShadow: `0 0 8px ${t.progressDone}80` }} />
      {MILESTONE_POSITIONS.map((pos, i) => {
        const isComplete = i < stageIndex
        const isActive = i === stageIndex
        return (
          <div key={i} className="absolute transition-all duration-500" style={{ left: `${pos}%`, top: '50%', transform: 'translate(-50%,-50%)' }}>
            {isActive && <div className="absolute rounded-full animate-ping" style={{ width: 15, height: 15, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: `${t.progressDone}30` }} />}
            <div className="relative rounded-full transition-all duration-500" style={{ width: isActive ? 10 : 8, height: isActive ? 10 : 8, background: isComplete ? t.progressDone : isActive ? (theme === 'dark' ? '#a5b4fc' : '#b39dff') : t.progressRemain, border: isActive ? `2px solid ${t.progressDone}` : isComplete ? 'none' : `2px solid ${t.textFaint}`, boxShadow: isActive ? `0 0 9px ${t.progressDone}` : 'none' }} />
          </div>
        )
      })}
    </div>
  )
}

function BottomFeedbackBar({ theme }: { theme: Theme }) {
  const [dismissed, setDismissed] = useState(false)
  const t = THEME[theme]
  if (dismissed) return null
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-2" style={{ background: t.headerBg, backdropFilter: 'blur(12px)', borderTop: `1px solid ${t.footerBorder}` }}>
      <span style={{ color: t.textMuted, fontSize: '0.7rem' }}>Did Filtr. save you time today?</span>
      <div className="flex items-center gap-2">
        <a href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer" onClick={() => setDismissed(true)}
          className="font-medium px-3 py-1 rounded-lg border hover:opacity-90 transition-opacity"
          style={{ background: '#d1fae5', color: '#065f46', borderColor: '#6ee7b7', fontSize: '0.7rem' }}>Yes, it did</a>
        <a href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer" onClick={() => setDismissed(true)}
          className="font-medium px-3 py-1 rounded-lg transition-colors"
          style={{ background: t.bgCard, color: t.textMuted, border: `1px solid ${t.border}`, fontSize: '0.7rem' }}>Not really</a>
        <button onClick={() => setDismissed(true)} className="hover:opacity-70 transition-opacity ml-1" style={{ color: t.textFaint }}><X size={11} /></button>
      </div>
    </div>
  )
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const t = THEME[theme]
  return (
    <button onClick={onToggle} className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:opacity-80" style={{ border: `1px solid ${t.border}`, background: t.bgCard, color: t.toggleIcon }} aria-label="Toggle theme">
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}

export default function Home() {
  const [step, setStep] = useState<'upload' | 'loading' | 'query'>('upload')
  const [theme, setTheme] = useState<Theme>('dark')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState<FileResult[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [lastQuery, setLastQuery] = useState<string | null>(null)
  const [querying, setQuerying] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [showSources, setShowSources] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [insights, setInsights] = useState<Cluster[]>([])
  const [currentStage, setCurrentStage] = useState<StageKey>('uploading')
  const [countdown, setCountdown] = useState(60)
  const [fillPct, setFillPct] = useState(0)
  const [queriesUsed, setQueriesUsed] = useState(0)
  const [capReached, setCapReached] = useState(false)
  const [suggestedQueries, setSuggestedQueries] = useState<string[]>([])

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fillRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const t = THEME[theme]
  const totalChunks = uploadResults.reduce((a, r) => a + r.chunks, 0)
  const bg = theme === 'dark' ? DARK_BG : LIGHT_BG

  useEffect(() => {
    try {
      const saved = localStorage.getItem('filtr-theme') as Theme | null
      if (saved === 'light' || saved === 'dark') setTheme(saved)
    } catch {}
  }, [])

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try { localStorage.setItem('filtr-theme', next) } catch {}
  }

  const startCountdown = (from: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setCountdown(from)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => { if (prev <= 1) { clearInterval(countdownRef.current!); return 1 } return prev - 1 })
    }, 1000)
  }

  const stopCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    if (fillRef.current) clearInterval(fillRef.current)
  }

  const crawlFill = (targetPct: number, stepSize = 0.4, intervalMs = 80) => {
    if (fillRef.current) clearInterval(fillRef.current)
    fillRef.current = setInterval(() => {
      setFillPct(prev => { if (prev >= targetPct) { clearInterval(fillRef.current!); return targetPct } return Math.min(prev + stepSize, targetPct) })
    }, intervalMs)
  }

  useEffect(() => () => stopCountdown(), [])

  const goHome = () => {
    setStep('upload')
    setFiles([])
    setUploadResults([])
    setResult(null)
    setLastQuery(null)
    setSessionId(null)
    setInsights([])
    setSuggestedQueries([])
    setQueriesUsed(0)
    setCapReached(false)
    stopCountdown()
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const newFiles = Array.from(e.dataTransfer.files)
    setFiles(prev => [...prev, ...newFiles])
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files)
      setFiles(prev => [...prev, ...newFiles])
    }
  }

  const removeFile = (index: number) => setFiles(prev => prev.filter((_, i) => i !== index))

  const handleUpload = async () => {
    if (!files.length) return
    setUploading(true)
    setUploadError(null)
    setCurrentStage('uploading')
    setFillPct(0)
    setQueriesUsed(0)
    setCapReached(false)
    setLastQuery(null)
    setSuggestedQueries([])
    startCountdown(100)
    setStep('loading')
    setInsights([])
    crawlFill(28)
    const formData = new FormData()
    files.forEach(file => formData.append('files', file))
    try {
      await fetch(`${API_BASE}/health`).catch(() => {})
      await new Promise(resolve => setTimeout(resolve, 3000))
      setCurrentStage('indexing'); setFillPct(33); startCountdown(60); crawlFill(58)
      const res = await fetch(`${API_BASE}/ingest`, { method: 'POST', body: formData })
      if (!res.ok) { const err = await res.json(); throw new Error(err.detail || 'Upload failed') }
      const data = await res.json()
      setSessionId(data.session_id); setUploadResults(data.files)
      setCurrentStage('clustering'); setFillPct(66); startCountdown(30); crawlFill(88)
      const sid = data.session_id
      setTimeout(() => { setCurrentStage('ready'); setFillPct(90); startCountdown(10); crawlFill(96) }, 15000)
      setTimeout(() => {
        fetch(`${API_BASE}/insights`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sid, n_clusters: 5 }) })
          .then(r => r.json())
          .then(d => {
            const clusters: Cluster[] = d.clusters || []
            setInsights(clusters)
            // ── Fetch suggestions using cluster names ──
            const clusterNames = clusters.map((c: Cluster) => c.name).filter(Boolean)
            const allExcerpts = clusters.flatMap((c: Cluster) => c.excerpts || []).slice(0, 8)
            fetch(`${API_BASE}/suggestions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: sid, cluster_names: clusterNames, excerpts: allExcerpts }),
            })
              .then(r => r.json())
              .then(s => { if (s.suggestions?.length) setSuggestedQueries(s.suggestions) })
              .catch(() => {
                // Fallback: generate from cluster names client-side
                setSuggestedQueries(clusterNames.slice(0, 3).map((n: string) => `Tell me more about ${n}`))
              })
          })
          .catch(() => setInsights([]))
          .finally(() => { stopCountdown(); setFillPct(100); setTimeout(() => setStep('query'), 400) })
      }, 2000)
    } catch (err: any) {
      setUploadError(err.message); stopCountdown(); setStep('upload')
    } finally { setUploading(false) }
  }

  const handleQuery = async (q?: string) => {
    const queryText = q || query
    if (!queryText.trim() || !sessionId || capReached) return
    setQuerying(true); setQueryError(null); setResult(null)
    setLastQuery(queryText)
    setQuery('')
    try {
      const res = await fetch(`${API_BASE}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: queryText, session_id: sessionId }) })
      if (!res.ok) {
        const err = await res.json()
        if (err.detail?.includes('QUERY_CAP_REACHED')) { setCapReached(true); setQueriesUsed(QUERY_CAP); return }
        throw new Error(err.detail || 'Query failed')
      }
      const data = await res.json()
      setResult(data)
      setQueriesUsed(prev => { const next = prev + 1; if (next >= QUERY_CAP) setCapReached(true); return next })
    } catch (err: any) { setQueryError(err.message) }
    finally { setQuerying(false) }
  }

  const stageIndex = STAGES.findIndex(s => s.key === currentStage)

  return (
    <div className="min-h-screen transition-colors duration-300" style={{ background: bg }}>

      {/* ── Header — UNTOUCHED ── */}
      <header className="sticky top-0 z-10 transition-colors duration-300" style={{ borderBottom: `1px solid ${t.footerBorder}`, background: t.headerBg, backdropFilter: 'blur(16px)' }}>
        <div className="max-w-5xl mx-auto px-8 py-4 flex items-center justify-between">
          <button onClick={goHome} className="flex items-center gap-2.5 hover:opacity-75 transition-opacity">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-900/30">
              <Zap size={15} className="text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight" style={{ color: t.text }}>Filtr.</span>
          </button>
          <div className="flex items-center gap-3">
            {step === 'query' && (
              <>
                <a href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-medium px-4 py-1.5 rounded-full transition-all hover:opacity-80"
                  style={{ border: `1px solid ${t.accentText}`, color: t.accentText }}>
                  Share Feedback
                </a>
                <button onClick={goHome} className="text-sm transition-colors hover:opacity-70" style={{ color: t.textMuted }}>
                  Back to upload
                </button>
              </>
            )}
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 pb-16">

        {/* ── UPLOAD STEP ── */}
        {step === 'upload' && (
          <div className="max-w-xl mx-auto flex flex-col justify-center" style={{ minHeight: 'calc(100vh - 130px)' }}>

            {/* Hero — scaled to 0.75x */}
            <div className="text-center mb-7 pt-3">
              <h1 className="font-extrabold tracking-tight mb-4" style={{ fontSize: '5.25rem', lineHeight: 0.95, color: t.text }}>
                Filtr.
              </h1>
              <p className="font-semibold leading-snug" style={{ fontSize: '1.125rem', lineHeight: 1.4, color: t.accentText, maxWidth: '420px', margin: '0 auto' }}>
                AI that filters your Slack, Jira, and transcript noise into ranked, actionable user insight.
              </p>
            </div>

            {/* Upload zone */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-2xl px-6 py-6 text-center cursor-pointer transition-all"
              style={{
                border: dragOver ? `2px dashed ${t.accentText}` : `2px dashed ${t.border}`,
                background: dragOver ? `${t.accentText}08` : t.bgCard,
              }}
            >
              <Upload size={22} className="mx-auto mb-2" style={{ color: t.accentText }} />
              <p className="font-semibold mb-1" style={{ color: t.text, fontSize: '0.85rem' }}>Drop files here or click to browse</p>
              <p style={{ color: t.textFaint, fontSize: '0.75rem' }}>Slack JSON · Jira CSV · Transcripts PDF/TXT · Max 10MB per file</p>
              <input ref={fileInputRef} type="file" multiple accept=".json,.csv,.pdf,.txt" onChange={handleFileSelect}
                style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0, overflow: 'hidden' }} />
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {files.map((file, i) => (
                  <div key={i} className="rounded-xl px-3 py-2 flex items-center justify-between gap-2" style={{ background: t.bgCard, border: `1px solid ${t.border}` }}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText size={11} style={{ color: t.accentText }} />
                      <span className="truncate" style={{ color: t.text, fontSize: '0.75rem' }}>{file.name}</span>
                      <span className="shrink-0" style={{ color: t.textFaint, fontSize: '0.65rem' }}>({(file.size / 1024).toFixed(0)} KB)</span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); removeFile(i) }} className="hover:text-red-400 transition-colors shrink-0" style={{ color: t.textFaint }}>
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Mock files */}
            <p className="text-center mt-3" style={{ color: t.textFaint, fontSize: '0.75rem' }}>
              No data? Try with our{' '}
              <a href="/mock_data/slack_export_mock.json" download style={{ color: t.accentText }} className="underline hover:opacity-70">Slack</a>,{' '}
              <a href="/mock_data/jira_export_mock.csv" style={{ color: t.accentText }} className="underline hover:opacity-70">Jira</a>,{' '}
              <a href="/mock_data/transcript_mock.txt" download style={{ color: t.accentText }} className="underline hover:opacity-70">Transcript</a>{' '}
              mock files
            </p>

            {uploadError && (
              <div className="mt-3 flex items-center gap-2 bg-red-900/20 border border-red-800/50 rounded-xl px-3 py-2 text-red-400" style={{ fontSize: '0.75rem' }}>
                <AlertCircle size={12} /> {uploadError}
              </div>
            )}

            {/* CTA */}
            <button
              onClick={handleUpload}
              disabled={!files.length || uploading}
              className="mt-4 w-full text-white font-bold py-3 px-5 rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: t.accentText, boxShadow: `0 4px 24px ${t.accentText}40`, fontSize: '0.85rem' }}
            >
              {uploading
                ? <><Loader2 size={14} className="animate-spin" /> Indexing your data...</>
                : <><Zap size={14} /> Analyse My Data</>
              }
            </button>

            {/* Trust signals */}
            <p className="text-center mt-3" style={{ color: t.textFaint, fontSize: '0.75rem' }}>
              🔒 Your data is safe, we don't save any file after indexing
            </p>
            <p className="text-center mt-1" style={{ color: t.textFaint, fontSize: '0.75rem' }}>
              First load may take 1-2 minutes while the server wakes up.
            </p>

            {/* Attribution */}
            <p className="text-center mt-6" style={{ color: t.footerText, fontSize: '0.75rem' }}>
              Made by{' '}
              <a href="https://www.linkedin.com/in/shubhsankalpdas/" target="_blank" rel="noopener noreferrer" style={{ color: t.accentText }} className="underline hover:opacity-70">
                Shubh Sankalp Das
              </a>
            </p>
          </div>
        )}

        {/* ── LOADING STEP ── */}
        {step === 'loading' && (
          <div className="max-w-lg mx-auto flex flex-col justify-center" style={{ minHeight: 'calc(100vh - 130px)' }}>
            <div className="text-center mb-10">
              <p className="font-extrabold tracking-tight mb-4" style={{ fontSize: '3.75rem', lineHeight: 0.95, color: t.text }}>Filtr.</p>
              <p className="uppercase tracking-widest mb-4 font-medium" style={{ color: t.textMuted, fontSize: '0.75rem' }}>Analysing Your Data</p>
              <p className="font-light tabular-nums" style={{ fontSize: '2.625rem', color: t.text }}>~{countdown}s</p>
              <p className="mt-1" style={{ color: t.textFaint, fontSize: '0.75rem' }}>remaining</p>
            </div>

            <div className="mb-3 px-2">
              <MilestoneBar stageIndex={stageIndex} fillPct={fillPct} theme={theme} />
            </div>

            <div className="relative mb-9" style={{ height: '18px' }}>
              {STAGES.map((s, i) => {
                const isComplete = i < stageIndex
                const isActive = i === stageIndex
                const pos = MILESTONE_POSITIONS[i]
                return (
                  <span key={s.key} className="absolute uppercase tracking-wide transition-colors duration-500"
                    style={{
                      left: `${pos}%`,
                      transform: i === 0 ? 'translateX(0)' : i === STAGES.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                      color: isComplete ? t.progressDone : isActive ? t.text : t.textFaint,
                      fontWeight: isActive ? '700' : '400',
                      fontSize: '0.65rem',
                    }}>
                    {s.label}
                  </span>
                )
              })}
            </div>

            <p className="text-center mb-6" style={{ color: t.textFaint, fontSize: '0.75rem' }}>
              {countdown <= 1 ? 'Still working — server is under load, please wait...' : STAGE_STATUS_LINES[currentStage](totalChunks)}
            </p>

            <div className="mx-auto w-full rounded-2xl px-5 py-4 text-center" style={{ background: t.warningBg, border: `1px solid ${t.warningBorder}` }}>
              <p className="leading-relaxed" style={{ color: t.warningText, fontSize: '0.75rem' }}>
                ⏳ <span className="font-semibold">First load takes 1-2 minutes to get the servers started. Subsequent sessions will be significantly faster.</span>
              </p>
            </div>

            <p className="text-center mt-8" style={{ color: t.footerText, fontSize: '0.75rem' }}>
              Made by{' '}
              <a href="https://www.linkedin.com/in/shubhsankalpdas/" target="_blank" rel="noopener noreferrer" style={{ color: t.accentText }} className="underline hover:opacity-70">
                Shubh Sankalp Das
              </a>
            </p>
          </div>
        )}

        {/* ── QUERY STEP ── */}
        {step === 'query' && (
          <div className="pt-6">

            {/* Upload summary */}
            <div className="rounded-xl p-2 mb-3 flex flex-wrap gap-2 items-center cursor-not-allowed select-none" style={{ background: t.bgCard, border: `1px solid ${t.border}` }}>
              <CheckCircle size={12} className="text-emerald-400 shrink-0" />
              <span className="font-medium" style={{ color: t.text, fontSize: '0.65rem' }}>Data indexed</span>
              {uploadResults.map((r, i) => (
                <span key={i} className="rounded-lg px-2 py-1 inline-flex items-center gap-1" style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.04)' : '#f3f3f3', border: `1px solid ${t.border}`, color: t.textMuted, fontSize: '0.65rem' }}>
                  <Info size={8} style={{ color: t.accentText }} />
                  {r.file} <span style={{ color: t.accentText }}>{r.chunks} chunks</span>
                </span>
              ))}
            </div>

            {/* Cluster tabs */}
            {insights.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Zap size={11} style={{ color: t.accentText }} />
                  <h2 className="font-semibold uppercase tracking-wide" style={{ color: t.accentText, fontSize: '0.75rem' }}>Top Issues</h2>
                  <span className="ml-1" style={{ color: t.textFaint, fontSize: '0.65rem' }}>auto-detected from your data</span>
                </div>
                <div className="flex flex-col gap-1">
                  {insights.map((cluster, i) => <ClusterTab key={i} cluster={cluster} theme={theme} onSelect={(name) => setQuery(`Tell me more about ${name}`)} />)}
                </div>
                <div className="mt-3 h-px" style={{ background: t.border }} />
              </div>
            )}

            {/* Query input */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold uppercase tracking-wide" style={{ color: t.accentText, fontSize: '0.75rem' }}>Ask a question</span>
                <QueryCounter used={queriesUsed} cap={QUERY_CAP} theme={theme} />
              </div>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: t.textFaint }} />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
                    placeholder={capReached ? 'Query limit reached — restart to continue' : 'Pick a suggestion or type your own question'}
                    disabled={capReached}
                    className="w-full rounded-xl pl-8 pr-3 py-2.5 focus:outline-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: t.inputBg, border: `1px solid ${t.border}`, color: t.text, fontSize: '0.75rem' }}
                  />
                </div>
                <button
                  onClick={() => handleQuery()}
                  disabled={!query.trim() || querying || capReached}
                  className="text-white font-medium px-4 rounded-xl transition-all flex items-center gap-1.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-85"
                  style={{ background: t.accentText, fontSize: '0.75rem' }}
                >
                  {querying ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                  Ask
                </button>
              </div>
              {!capReached && suggestedQueries.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {suggestedQueries.map((q, i) => (
                    <button key={i} onClick={() => handleQuery(q)} disabled={capReached}
                      className="rounded-full px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-70"
                      style={{ color: t.textMuted, background: t.pillBg, border: `1px solid ${t.border}`, fontSize: '0.7rem' }}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Cap reached */}
            {capReached && (
              <div className="flex items-start gap-2 rounded-xl px-3 py-3 mb-4" style={{ background: t.warningBg, border: `1px solid ${t.warningBorder}` }}>
                <AlertCircle size={12} className="mt-0.5 shrink-0" style={{ color: t.warningText }} />
                <div>
                  <p className="font-medium mb-0.5" style={{ color: t.warningText, fontSize: '0.75rem' }}>You've used all {QUERY_CAP} free questions</p>
                  <p style={{ color: t.textFaint, fontSize: '0.65rem' }}>Click "Back to upload" to start a fresh session with new files.</p>
                </div>
              </div>
            )}

            {querying && (
              <div className="flex items-center gap-2 py-6 justify-center" style={{ color: t.textMuted, fontSize: '0.75rem' }}>
                <Loader2 size={15} className="animate-spin" style={{ color: t.accentText }} />
                <span>Searching your data and generating answer...</span>
              </div>
            )}

            {queryError && (
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 mb-3 ${queryError.includes('cooling down') ? 'bg-blue-900/20 border border-blue-800/50 text-blue-400' : 'bg-red-900/20 border border-red-800/50 text-red-400'}`} style={{ fontSize: '0.75rem' }}>
                <AlertCircle size={12} />
                {queryError.includes('cooling down') ? '⏳ System is busy — all API keys are cooling down. Wait 60 seconds and try again.' : queryError}
              </div>
            )}

            {result && !querying && (
              <div className="space-y-4">
                {/* Last question asked */}
                {lastQuery && (
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold uppercase tracking-wide" style={{ color: t.textFaint, fontSize: '0.65rem' }}>You asked</span>
                    <span className="rounded-full px-2 py-0.5 font-medium" style={{ background: t.pillBg, border: `1px solid ${t.border}`, color: t.text, fontSize: '0.65rem' }}>
                      {lastQuery}
                    </span>
                  </div>
                )}
                <div className="rounded-xl p-4" style={{ background: t.bgCard, border: `1px solid ${t.border}` }}>
                  <div className="flex items-center gap-1.5 mb-3">
                    <Zap size={11} style={{ color: t.accentText }} />
                    <span className="font-medium uppercase tracking-wide" style={{ color: t.accentText, fontSize: '0.65rem' }}>AI Answer</span>
                  </div>
                  <div className="leading-relaxed whitespace-pre-wrap" style={{ color: t.textMuted, fontSize: '0.75rem' }}>
                    {result.answer}
                  </div>
                </div>
                <div>
                  <button onClick={() => setShowSources(!showSources)} className="flex items-center gap-1.5 mb-2 transition-colors hover:opacity-80" style={{ color: t.textMuted, fontSize: '0.75rem' }}>
                    {showSources ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    Related data retrieved ({result.sources.length})
                  </button>
                  {showSources && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {result.sources.map((source, i) => <SourceCard key={i} source={source} theme={theme} />)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      {step !== 'upload' && (
        <footer className="py-4 text-center" style={{ borderTop: `1px solid ${t.footerBorder}`, color: t.footerText, fontSize: '0.65rem' }}>
          Made by{' '}
          <a href="https://www.linkedin.com/in/shubhsankalpdas/" target="_blank" rel="noopener noreferrer" style={{ color: t.accentText }} className="underline hover:opacity-70">
            Shubh Sankalp Das
          </a>
        </footer>
      )}

      {step === 'query' && <BottomFeedbackBar theme={theme} />}
    </div>
  )
}