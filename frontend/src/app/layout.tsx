import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Filtr - AI Issue Intelligence',
  description: 'Upload your Slack, Jira, and transcripts. Ask what users are actually saying.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
