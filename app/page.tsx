import { startIndexer } from './indexer'
import prisma from '@/lib/prismadb'

export default async function Home() {
  try {
    // Test database connection
    const blockProgress = await prisma.blockProgress.findFirst()
    console.log('Current block height:', blockProgress?.lastBlockHeight)

    // Start indexer in background
    startIndexer().catch(console.error)
    
    return (
      <main className="flex min-h-screen flex-col items-center justify-between p-24">
        <h1>Indexer Running</h1>
        <div>Last Block: {blockProgress?.lastBlockHeight?.toString() || 'Not found'}</div>
      </main>
    )
  } catch (error: unknown) {
    console.error('Database connection error:', error)
    return <div>Error: {error instanceof Error ? error.message : 'Unknown error'}</div>
  }
}
