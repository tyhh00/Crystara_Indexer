import 'dotenv/config'  // Add this at the top
import { createLogger } from './utils'

const logger = createLogger('rpcClient')

const SUPRA_RPC_URL = process.env.NEXT_PUBLIC_SUPRA_RPC_URL!
const CRYSTARA_ADDRESS = process.env.NEXT_PUBLIC_CRYSTARA_ADR!
const COLLECTIONS_MODULE = process.env.NEXT_PUBLIC_COLLECTIONS_MODULE_NAME!
const TOKENS_MODULE_ADDRESS = process.env.NEXT_PUBLIC_TOKENS_MODULE_ADDRESS!
const TOKENS_MODULE = process.env.NEXT_PUBLIC_TOKENS_MODULE_NAME!

const MAX_RETRIES = 3
const MAX_BLOCK_RANGE = 10

interface EventResponse {
  events: Array<{
    guid: string
    sequence_number: number
    type: string
    data: any
    timestamp: number
  }>
}

export async function fetchLatestBlockHeight(): Promise<number> {
  try {
    logger.debug(`Fetching latest block height from ${SUPRA_RPC_URL}/block`)
    const response = await fetch(`${SUPRA_RPC_URL}/block`)
    if (!response.ok) { 
      if(response.status == 429) {
        logger.error(`Rate limit exceeded.`);
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json()
    return data.height
  } catch (error) {
    logger.error('Error fetching latest block height:', error)
    throw error
  }
}

// Add rate limiting configuration
const RATE_LIMIT_DELAY = 1 // Time between requests in ms

export async function fetchBlockEvents(
  startBlock: number,
  endBlock: number
): Promise<any[]> {
  if (endBlock - startBlock > MAX_BLOCK_RANGE) {
    endBlock = startBlock + MAX_BLOCK_RANGE
  }

  let events: any[] = []
  let retries = 0

  while (retries < MAX_RETRIES) {
    try {
      // Group similar events together to reduce API calls
      const moduleEvents = [

                // Token module events
        ...await fetchEventsByTypes([
          `${TOKENS_MODULE_ADDRESS}::${TOKENS_MODULE}::MintTokenEvent`,
          `${TOKENS_MODULE_ADDRESS}::${TOKENS_MODULE}::CreateTokenDataEvent`,
          `${TOKENS_MODULE_ADDRESS}::${TOKENS_MODULE}::CreateCollectionEvent`,
          `${TOKENS_MODULE_ADDRESS}::${TOKENS_MODULE}::MutateTokenPropertyMapEvent`,
          `${TOKENS_MODULE_ADDRESS}::${TOKENS_MODULE}::DepositEvent`,
          `${TOKENS_MODULE_ADDRESS}::${TOKENS_MODULE}::WithdrawEvent`,
          `${TOKENS_MODULE_ADDRESS}::${TOKENS_MODULE}::BurnTokenEvent`,
        ], startBlock, endBlock),

        // Crystara module events
        ...await fetchEventsByTypes([
          `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::TokenAddedEvent`,
          `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::TokensClaimedEvent`,
          `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::LootboxCreatedEvent`,
          `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::RaritiesSetEvent`,
          `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::LootboxPurchaseInitiatedEvent`,
          `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::LootboxRewardDistributedEvent`,
          `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::PriceUpdatedEvent`,
          `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::VRFCallbackReceivedEvent`,
          `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::LootboxStatusUpdatedEvent`
        ], startBlock, endBlock)
      ]

      events = moduleEvents
      break
    } catch (error) {
      retries++
      if (retries === MAX_RETRIES) throw error
      await sleep(1000 * Math.pow(2, retries))
    }
  }

  return events
}

async function fetchTokenEvents(startBlock: number, endBlock: number): Promise<any[]> {
  const eventTypes = [
    `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::TokenAddedEvent`,
    `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::TokensClaimedEvent`
  ]
  
  return fetchEventsByTypes(eventTypes, startBlock, endBlock)
}

async function fetchCollectionEvents(startBlock: number, endBlock: number): Promise<any[]> {
  const eventTypes = [
    `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::CollectionCreatedEvent`,
    `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::RaritiesSetEvent`
  ]
  
  return fetchEventsByTypes(eventTypes, startBlock, endBlock)
}

async function fetchLootboxEvents(startBlock: number, endBlock: number): Promise<any[]> {
  const eventTypes = [
    `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::LootboxCreatedEvent`,
    `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::LootboxPurchaseInitiatedEvent`,
    `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::LootboxRewardDistributedEvent`,
    `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::PriceUpdatedEvent`,
    `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::VRFCallbackReceivedEvent`,
    `${CRYSTARA_ADDRESS}::${COLLECTIONS_MODULE}::LootboxStatusUpdatedEvent`
  ]
  
  return fetchEventsByTypes(eventTypes, startBlock, endBlock)
}

async function fetchTokenTransferEvents(startBlock: number, endBlock: number): Promise<any[]> {
  const eventTypes = [
    // Token module events (0x3::token)
    `${TOKENS_MODULE_ADDRESS}::${TOKENS_MODULE}::MintTokenEvent`,
    `${TOKENS_MODULE_ADDRESS}::${TOKENS_MODULE}::CreateTokenDataEvent`,
    `${TOKENS_MODULE_ADDRESS}::${TOKENS_MODULE}::CreateCollectionEvent`,
    `${TOKENS_MODULE_ADDRESS}::${TOKENS_MODULE}::DepositEvent`,
    `${TOKENS_MODULE_ADDRESS}::${TOKENS_MODULE}::WithdrawEvent`,
    `${TOKENS_MODULE_ADDRESS}::${TOKENS_MODULE}::BurnTokenEvent`
  ]
  
  return fetchEventsByTypes(eventTypes, startBlock, endBlock)
}

const BATCH_SIZE = 10  // Adjust based on rate limits
const RETRY_DELAY = 300

async function fetchEventsByTypes(
  eventTypes: string[], 
  startBlock: number, 
  endBlock: number
): Promise<any[]> {
  const events: any[] = []
  
  // Process event types in smaller batches
  for (let i = 0; i < eventTypes.length; i += BATCH_SIZE) {
    const batchTypes = eventTypes.slice(i, i + BATCH_SIZE)
    
    // Fetch batch with retry logic
    const batchPromises = batchTypes.map(async (eventType) => {
      let retries = 0
      while (retries < 3) {
        try {
          const url = `${SUPRA_RPC_URL}/events/${eventType}?start=${startBlock}&end=${endBlock}`
          const response = await fetch(url)

          if (response.status === 429) {
            logger.debug('Rate limit exceeded, sleeping for 2 seconds')
            retries++
            await sleep(RETRY_DELAY * Math.pow(2, retries))
            continue
          }

          if (!response.ok) return []

          const responseData = await response.json()
          if (!responseData?.data?.length) return []

          return responseData.data.map((event: any) => ({
            type: eventType,
            guid: event.guid,
            sequenceNumber: event.sequence_number,
            timestamp: event.data.timestamp ?? -1,
            data: event.data
          }))
        } catch {
          retries++
          await sleep(RETRY_DELAY * Math.pow(2, retries))
        }
      }
      return []
    })

    // Wait for batch to complete
    const batchResults = await Promise.all(batchPromises)
    events.push(...batchResults.flat())
    
    // Add delay between batches
    if (i + BATCH_SIZE < eventTypes.length) {
      await sleep(RATE_LIMIT_DELAY)
    }
  }

  return events
}

// Helper function to handle rate limiting
let lastRequestTime = Date.now()
const MAX_REQUESTS_PER_SECOND = parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10', 10)

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
} 