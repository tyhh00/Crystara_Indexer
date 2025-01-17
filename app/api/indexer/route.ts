import { startIndexer } from '@/app/indexer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

let indexerRunning = false

export async function GET() {
  if (!indexerRunning) {
    indexerRunning = true
    // Run indexer in background
    startIndexer().catch((error) => {
      console.error('Indexer error:', error)
      indexerRunning = false
    })
  }
  return Response.json({ status: 'Indexer running' })
} 