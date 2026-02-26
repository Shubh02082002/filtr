'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, Search, FileText, MessageSquare, Layers, ChevronDown, ChevronUp, Loader2, CheckCircle, AlertCircle, X, Zap, ThumbsUp, ThumbsDown } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

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

function SourceCard({ source, index }: { source: Source; index: number }) {
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

function ClusterCard({ cluster }: { cluster: Cluster }) {
  const [vote, setVote] = useState<'up' | 'down' | null>(null)

  return (
    <div className="bg-[#141720] border border-[#2a2d3d] rounded-xl p-4 hover:border-[#3a3f55] transition-colors">
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className="font-semibold text-slate-100 text-sm leading-snug">{cluster.name}</span>
        <span className="text-xs text-slate-400 bg-[#1e2130] px-2 py-1 rounded-full shrink-0 border border-[#2a2d3d]">
          {cluster.count} mentions
        </span>
      </div>
      <div className="flex gap-2 flex-wrap mb-3">
        {cluster.sources.slack > 0 && (
          <span className="text-xs bg-purple-900/40 text-purple-300 border border-purple-700/50 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <MessageSquare size={10} /> Slack {cluster.sources.slack}
          </span>
        )}
        {cluster.sources.jira > 0 && (
          <span className="text-xs bg-blue-900/40 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <Layers size={10} /> Jira {cluster.sources.jira}
          </span>
        )}
        {cluster.sources.transcript > 0 && (
          <span className="text-xs bg-emerald-900/40 text-emerald-300 border border-emerald-700/50 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <FileText size={10} /> Transcript {cluster.sources.transcript}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-[#2a2d3d]">
        <span className="text-xs text-gray-600">Was this cluster useful?</span>
        <div className="flex gap-2">
          <button
            onClick={() => setVote('up')}
            className={`p-1.5 rounded-lg transition-colors ${vote === 'up' ? 'bg-emerald-900/50 text-emerald-400' : 'text-gray-600 hover:text-emerald-400 hover:bg-emerald-900/20'}`}
          >
            <ThumbsUp size={13} />
          </button>
          <button
            onClick={() => setVote('down')}
            className={`p-1.5 rounded-lg transition-colors ${vote === 'down' ? 'bg-red-900/50 text-red-400' : 'text-gray-600 hover:text-red-400 hover:bg-red-900/20'}`}
          >
            <ThumbsDown size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

const SAMPLE_QUERIES = [
  'What are the most common issues users report?',
  'What bugs are blocking users from completing checkout?',
  'What features are users requesting most?',
  'What onboarding problems are users experiencing?',
]

export default function Home() {
  const [step, setStep] = useState<'upload' | 'query'>('upload')
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
  const [insightsLoading, setInsightsLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    setFiles(prev => [...prev, ...dropped])
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)])
    }
  }

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleUpload = async () => {
    if (!files.length) return
    setUploading(true)
    setUploadError(null)

    const formData = new FormData()
    files.forEach(f => formData.append('files', f))

    try {
      const res = await fetch(`${API_BASE}/ingest`, { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Upload failed')
      }
      const data = await res.json()
      setSessionId(data.session_id)
      setUploadResults(data.files)
      setStep('query')

      // Auto-fetch insights after upload
      setInsightsLoading(true)
      setInsights([])
      setTimeout(() => {
        fetch(`${API_BASE}/insights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: data.session_id, n_clusters: 5 }),
        })
          .then(r => r.json())
          .then(d => {
            console.log('Insights received:', d)
            setInsights(d.clusters || [])
          })
          .catch((e) => { console.error('Insights error:', e); setInsights([]) })
          .finally(() => setInsightsLoading(false))
      }, 2000)

    } catch (err: any) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleQuery = async (q?: string) => {
    const queryText = q || query
    if (!queryText.trim() || !sessionId) return
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
        throw new Error(err.detail || 'Query failed')
      }
      const data = await res.json()
      setResult(data)
    } catch (err: any) {
      setQueryError(err.message)
    } finally {
      setQuerying(false)
    }
  }

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
            <button
              onClick={() => { setStep('upload'); setFiles([]); setUploadResults([]); setResult(null); setSessionId(null); setInsights([]) }}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Back to upload
            </button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">

        {/* UPLOAD STEP */}
        {step === 'upload' && (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-10">
              <h1 className="text-3xl font-bold text-white mb-3">
                What are users actually saying?
              </h1>
              <p className="text-gray-400 text-lg">
                Upload your Slack export, Jira CSV, or call transcripts.<br />
                Ask questions in plain English. Get sourced answers in seconds.
              </p>
            </div>

            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all
                ${dragOver
                  ? 'border-indigo-500 bg-indigo-900/10'
                  : 'border-[#2a2d3d] hover:border-[#3a3f55] bg-[#141720]'
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
                style={{ position: "absolute", width: "1px", height: "1px", opacity: 0, overflow: "hidden" }}
              />
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="mt-4 space-y-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between bg-[#141720] border border-[#2a2d3d] rounded-lg px-4 py-2">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-indigo-400" />
                      <span className="text-sm text-gray-300">{f.name}</span>
                      <span className="text-xs text-gray-600">({(f.size / 1024).toFixed(0)} KB)</span>
                    </div>
                    <button onClick={() => removeFile(i)} className="text-gray-600 hover:text-red-400 transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Mock data note */}
            <p className="text-center text-gray-600 text-sm mt-4">
              No data? Try with our{' '}
              <a href="/mock_data/slack_export_mock.json" download="slack_export_mock.json" className="text-indigo-400 hover:text-indigo-300 underline">Slack</a>,{' '}
              <a href="/mock_data/jira_export_mock.csv" className="text-indigo-400 hover:text-indigo-300 underline">Jira</a>,{' '}
              <a href="/mock_data/transcript_mock.txt" download="transcript_mock.txt" className="text-indigo-400 hover:text-indigo-300 underline">Transcript</a>{' '}
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
              {uploading ? (
                <><Loader2 size={18} className="animate-spin" /> Indexing your data...</>
              ) : (
                <><Zap size={18} /> Analyse My Data</>
              )}
            </button>
            <p className="text-center text-gray-500 text-xs mt-2">First load may take 30 seconds while the server wakes up.</p>
            {uploading && (
              <p className="text-center text-gray-500 text-sm mt-3">
                Embedding and indexing - this takes 20-60 seconds depending on file size
              </p>
            )}
          </div>
        )}

        {/* QUERY STEP */}
        {step === 'query' && (
          <div>
            {/* Upload summary */}
            <div className="bg-[#141720] border border-[#2a2d3d] rounded-xl p-4 mb-8 flex flex-wrap gap-3 items-center">
              <CheckCircle size={16} className="text-emerald-400 shrink-0" />
              <span className="text-sm text-gray-300 font-medium">Data indexed</span>
              {uploadResults.map((r, i) => (
                <span key={i} className="text-xs bg-[#1e2130] border border-[#2a2d3d] rounded-full px-3 py-1 text-gray-400">
                  {r.file} <span className="text-indigo-400">{r.chunks} chunks</span>
                </span>
              ))}
            </div>

            {/* Insight Panel */}
            {insightsLoading && (
              <div className="mb-8 bg-[#141720] border border-[#2a2d3d] rounded-xl p-6 flex items-center gap-3 text-gray-400">
                <Loader2 size={16} className="animate-spin text-indigo-400 shrink-0" />
                <span className="text-sm">Analysing your data and surfacing top issues...</span>
              </div>
            )}

            {!insightsLoading && insights.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <Zap size={14} className="text-indigo-400" />
                  <h2 className="text-sm font-semibold text-indigo-400 uppercase tracking-wide">Top Issues This Period</h2>
                  <span className="text-xs text-gray-600 ml-1">auto-detected from your data</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {insights.map((cluster, i) => (
                    <ClusterCard key={i} cluster={cluster} />
                  ))}
                </div>
                <div className="mt-3 h-px bg-[#2a2d3d]" />
              </div>
            )}

            {/* Query input */}
            <div className="mb-8">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
                    placeholder="What are the most common issues users report?"
                    className="w-full bg-[#141720] border border-[#2a2d3d] rounded-xl pl-10 pr-4 py-3.5 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600 transition-colors"
                  />
                </div>
                <button
                  onClick={() => handleQuery()}
                  disabled={!query.trim() || querying}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-6 rounded-xl transition-colors flex items-center gap-2 shrink-0"
                >
                  {querying ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                  Ask
                </button>
              </div>

              {/* Sample queries */}
              <div className="mt-3 flex flex-wrap gap-2">
                {SAMPLE_QUERIES.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleQuery(q)}
                    className="text-xs text-gray-400 hover:text-indigo-300 bg-[#141720] border border-[#2a2d3d] hover:border-indigo-800/50 rounded-full px-3 py-1.5 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Loading */}
            {querying && (
              <div className="flex items-center gap-3 text-gray-400 py-8 justify-center">
                <Loader2 size={20} className="animate-spin text-indigo-400" />
                <span>Searching your data and generating answer...</span>
              </div>
            )}

            {/* Error */}
            {queryError && (
              <div className="flex items-center gap-2 bg-red-900/20 border border-red-800/50 rounded-lg px-4 py-3 text-red-400 text-sm">
                <AlertCircle size={16} /> {queryError}
              </div>
            )}

            {/* Result */}
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
                        <SourceCard key={i} source={source} index={i} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1e2130] mt-20 py-6 text-center text-xs text-gray-700">
        Filtr · Files processed in-memory and not stored after indexing · Built with Gemini + Pinecone
      </footer>
    </div>
  )
}
