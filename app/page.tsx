import { startIndexer } from './indexer'

export default async function Home() {
  try {
    // Start indexer in background
    startIndexer().catch(console.error)
    
    return (
      <main className="flex min-h-screen flex-col items-center justify-between p-24">
        <h1>Indexer Running</h1>
      </main>
    )
  } catch (error) {
    console.error('Failed to start indexer:', error)
    return <div>Error starting indexer</div>
  }
}
