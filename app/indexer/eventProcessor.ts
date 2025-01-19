import prismadb from '@/lib/prismadb'
import { createLogger } from './utils'
import { deserializeVectorU8 } from './utils'

const logger = createLogger('eventProcessor')
const MODULE_PATH = `${process.env.NEXT_PUBLIC_CRYSTARA_ADR}::${process.env.NEXT_PUBLIC_COLLECTIONS_MODULE_NAME}`
const TOKEN_MODULE_PATH = `${process.env.NEXT_PUBLIC_TOKENS_MODULE_ADDRESS}::${process.env.NEXT_PUBLIC_TOKENS_MODULE_NAME}`

type TransactionClient = Omit<
  typeof prismadb,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

// Add helper function for account creation/retrieval
async function getOrCreateAccount(address: string, tx: TransactionClient) {
  let account = await tx.account.findUnique({
    where: { address }
  })

  if (!account) {
    account = await tx.account.create({
      data: { address }
    })
  }

  return account
}

export async function processEvents(events: any[], tx: TransactionClient) {
  logger.debug(`Processing ${events.length} events`, events)
  
  for (const event of events) {
    try {
      logger.debug(`Processing event of type ${event.type}`, event)
      
      // Track the event before processing
      await tx.eventTracking.create({
        data: {
          eventType: event.type,
          blockHeight: BigInt(event.blockHeight || 0),
          transactionHash: event.transactionHash || '',
          processed: false, // Mark as unprocessed initially
          error: null
        }
      })
      
      // Process the event
      switch (event.type) {
        case `${MODULE_PATH}::CollectionCreatedEvent`:
          await processCollectionCreated(event, tx)
          break
        case `${MODULE_PATH}::LootboxCreatedEvent`:
          await processLootboxCreated(event, tx)
          break
        case `${MODULE_PATH}::LootboxPurchaseInitiatedEvent`:
          await processLootboxPurchaseInitiated(event, tx)
          break
        case `${MODULE_PATH}::LootboxRewardDistributedEvent`:
          await processLootboxRewardDistributed(event, tx)
          break
        case `${MODULE_PATH}::RaritiesSetEvent`:
          await processRaritiesSet(event, tx)
          break
        case `${MODULE_PATH}::TokenAddedEvent`:
          await processTokenAdded(event, tx)
          break
        case `${MODULE_PATH}::PriceUpdatedEvent`:
          await processPriceUpdated(event, tx)
          break
        case `${MODULE_PATH}::VRFCallbackReceivedEvent`:
          await processVRFCallback(event, tx)
          break
        case `${MODULE_PATH}::TokensClaimedEvent`:
          await processTokensClaimed(event, tx)
          break
        case `${TOKEN_MODULE_PATH}::TokenBurnEvent`:
          await processTokenBurn(event, tx)
          break
        case `${TOKEN_MODULE_PATH}::TokenMintEvent`:
          await processTokenMint(event, tx)
          break
        case `${TOKEN_MODULE_PATH}::MintTokenEvent`:
          await processTokenMint(event, tx)
          break
        case `${TOKEN_MODULE_PATH}::CreateTokenDataEvent`:
          await processTokenData(event, tx)
          break
        case `${TOKEN_MODULE_PATH}::CreateCollectionEvent`:
          await processTokenCollection(event, tx)
          break
        case `${TOKEN_MODULE_PATH}::DepositEvent`:
          await processTokenDeposit(event, tx)
          break
        case `${TOKEN_MODULE_PATH}::WithdrawEvent`:
          await processTokenWithdraw(event, tx)
          break
        case `${MODULE_PATH}::LootboxStatusUpdatedEvent`:
          await processLootboxStatusUpdated(event, tx)
          break
        default:
          logger.warn(`Unknown event type: ${event.type}`)
      }

      // Update event tracking to mark as processed
      await tx.eventTracking.updateMany({
        where: {
          eventType: event.type,
          blockHeight: BigInt(event.blockHeight || 0),
          processed: false
        },
        data: {
          processed: true
        }
      })
      
    } catch (error) {
      logger.error(`Error processing event ${event.type}:`, error)
      
      // Don't try to create a new tracking record, just throw the error
      // The transaction will be rolled back and retried by the poller
      throw error
    }
  }
}

async function processCollectionCreated(event: any, tx: TransactionClient) {
  logger.debug('Creating collection', event)
  
  try {
    // First attempt with local variables
    const creatorAddress = event.data.creator;
    const collectionName = deserializeVectorU8(event.data.collection_name);
    const metadataUri = deserializeVectorU8(event.data.metadata_uri);
    
    const collection = await tx.collection.create({
      data: {
        creatorAddress,
        collectionName,
        metadataUri,
      }
    });

    
    logger.debug('Collection created:', collection)
    logger.info(`Processed CollectionCreatedEvent: ${collection.id}`)
    
    return collection;
  } catch (error) {
    logger.error('Failed to create collection:', error)
    throw error
  }
}

async function processLootboxCreated(event: any, tx: TransactionClient) {
  // First find the collection
  const collection = await tx.collection.findFirst({
    where: {
      creatorAddress: event.data.creator,
      collectionName: deserializeVectorU8(event.data.collection_name),
    }
  })

  if (!collection) {
    throw new Error('Collection not found')
  }

  const lootbox = await tx.lootbox.create({
    data: {
      collectionId: collection.id,
      price: BigInt(event.data.price),
      priceCoinType: event.data.price_coinType,
      maxStock: BigInt(event.data.max_stock),
      availableStock: BigInt(event.data.initial_stock),
      timestamp: BigInt(event.data.timestamp)
    }
  })
  logger.info(`Processed LootboxCreatedEvent: ${lootbox.id}`)
}

async function processLootboxPurchaseInitiated(event: any, tx: TransactionClient) {
  const collection = await tx.collection.findFirst({
    where: {
      creatorAddress: event.data.creator,
      collectionName: event.data.collection_name
    },
    include: {
      lootboxes: true
    }
  })

  if (!collection || !collection.lootboxes[0]) {
    throw new Error('Collection or Lootbox not found')
  }

  // Ensure buyer account exists
  await getOrCreateAccount(event.data.buyer, tx)

  const purchase = await tx.lootboxPurchase.create({
    data: {
      lootboxId: collection.lootboxes[0].id,
      buyerAddress: event.data.buyer,
      quantity: BigInt(event.data.quantity),
      nonce: String(event.data.nonce),
      price: BigInt(event.data.price),
      priceCoinType: event.data.price_coinType,
    }
  })

  // Update lootbox analytics
  await tx.lootbox.update({
    where: { id: collection.lootboxes[0].id },
    data: {
      totalVolume: {
        increment: BigInt(event.data.price) * BigInt(event.data.quantity)
      },
      purchaseCount: {
        increment: 1
      },
      availableStock: {
        decrement: BigInt(event.data.quantity)
      }
    }
  })

  // Update collection analytics
  await tx.collectionAnalytics.upsert({
    where: { collectionId: collection.id },
    create: {
      collectionId: collection.id,
      volume24h: BigInt(event.data.price) * BigInt(event.data.quantity),
      purchases24h: 1,
      uniqueBuyers24h: 1
    },
    update: {
      volume24h: {
        increment: BigInt(event.data.price) * BigInt(event.data.quantity)
      },
      purchases24h: {
        increment: 1
      }
    }
  })

  logger.info(`Processed LootboxPurchaseInitiatedEvent: ${purchase.id}`)
}

async function processLootboxRewardDistributed(event: any, tx: TransactionClient) {
  const purchase = await tx.lootboxPurchase.findFirst({
    where: {
      nonce: String(event.data.nonce),
      buyerAddress: event.data.buyer
    }
  })

  if (!purchase) {
    throw new Error('Purchase not found')
  }

  const reward = await tx.lootboxReward.create({
    data: {
      purchaseId: purchase.id,
      selectedToken: event.data.selected_token,
      selectedRarity: event.data.selected_rarity,
      randomNumber: event.data.random_number.toString(),
      nonce: String(event.data.nonce),
      buyerAddress: event.data.buyer,
      collectionName: event.data.collection_name,
      timestamp: BigInt(event.data.timestamp)
    }
  })
  logger.info(`Processed LootboxRewardDistributedEvent: ${reward.id}`)
}

async function processRaritiesSet(event: any, tx: TransactionClient) {
  const collection = await tx.collection.findFirst({
    where: {
      creatorAddress: event.data.creator,
      collectionName: event.data.collection_name
    }
  })

  if (!collection) {
    throw new Error('Collection not found')
  }

  // Create rarities in batch
  const rarities = await Promise.all(
    event.data.rarity_names.map((name: string, index: number) =>
      tx.rarity.create({
        data: {
          collectionId: collection.id,
          rarityName: name,
          weight: BigInt(event.data.weights[index])
        }
      })
    )
  )
  logger.info(`Processed RaritiesSetEvent: ${rarities.length} rarities`)
}

async function processTokenAdded(event: any, tx: TransactionClient) {
  const collection = await tx.collection.findFirst({
    where: {
      creatorAddress: event.data.creator,
      collectionName: event.data.collection_name
    },
    include: {
      rarities: true
    }
  })

  if (!collection) {
    throw new Error('Collection not found')
  }

  const rarity = collection.rarities.find(r => r.rarityName === event.data.rarity)
  if (!rarity) {
    throw new Error('Rarity not found')
  }

  const token = await tx.token.create({
    data: {
      collectionId: collection.id,
      tokenName: event.data.token_name,
      tokenUri: event.data.token_uri,
      rarityId: rarity.id,
      maxSupply: BigInt(event.data.max_supply),
      circulatingSupply: BigInt(0),
      tokensBurned: BigInt(0),
    }
  })
  logger.info(`Processed TokenAddedEvent: ${token.id}`)
}

async function processPriceUpdated(event: any, tx: TransactionClient) {
  logger.debug('Processing price update', event)
  const collection = await tx.collection.findFirst({
    where: {
      creatorAddress: event.data.creator,
      collectionName: event.data.collection_name
    },
    include: {
      lootboxes: true
    }
  })

  if (!collection || !collection.lootboxes[0]) {
    throw new Error('Collection or Lootbox not found')
  }

  const lootbox = await tx.lootbox.update({
    where: { id: collection.lootboxes[0].id },
    data: {
      price: BigInt(event.data.price),
      priceCoinType: event.data.price_coinType
    }
  })
  logger.info(`Processed PriceUpdatedEvent: ${lootbox.id}`)
}

async function processVRFCallback(event: any, tx: TransactionClient) {
  logger.debug('Processing VRF callback', event)
  await tx.vRFCallback.create({
    data: {
      callerAddress: event.data.caller_address,
      nonce: String(event.data.nonce),
      randomNumbers: event.data.random_numbers.map((n: string) => String(n)),
      timestamp: BigInt(event.data.timestamp)
    }
  })
  logger.info(`Processed VRFCallbackReceivedEvent`)
}

async function processTokensClaimed(event: any, tx: TransactionClient) {
  logger.debug('Processing tokens claimed', event)
  
  // Transform the tokensClaimed array to match the expected format
  const tokensClaimed = event.data.tokens_claimed.map((token: any) => ({
    collection: token.collection,
    creator: token.creator,
    name: token.name
  }));

  await tx.tokenClaim.create({
    data: {
      claimer: event.data.claimer,
      claimResourceAddress: event.data.claim_resource_address,
      tokensClaimed: tokensClaimed,
      totalTokens: BigInt(event.data.total_tokens),
      timestamp: BigInt(event.data.timestamp)
    }
  })
  logger.info(`Processed TokensClaimedEvent`)
}

async function processTokenBurn(event: any, tx: TransactionClient) {
  logger.debug('Processing token burn', event)
  
  const tokenId = event.data.id
  const accountAddress = tokenId.token_data_id.creator
  const amount = BigInt(event.data.amount)
  const propertyVersion = BigInt(tokenId.property_version)

  await tx.tokenBurn.create({
    data: {
      tokenId: event.data.token_id,
      amount: BigInt(event.data.amount),
      fromAddress: event.guid.account_address,
    }
  })

  await tx.token.updateMany({
    where: {
      tokenName: tokenId.token_data_id.name,
      collection: {
        creatorAddress: tokenId.token_data_id.creator,
        collectionName: tokenId.token_data_id.collection
      },
      propertyVersion: propertyVersion
    },
    data: {
      tokensBurned: {
        increment: amount
      }
    }
  })

  // Record burn in transaction history
  await tx.tokenTransaction.create({
    data: {
      accountAddress,
      tokenDataId: tokenId.token_data_id,
      transactionType: 'BURN',
      amount,
      fromAddress: event.guid.account_address,
    }
  })

  logger.info(`Processed TokenBurnEvent`)
}


async function processTokenMint(event: any, tx: TransactionClient) {
  logger.debug('Processing token mint', event)

  const tokenId = event.data.id
  const amount = BigInt(event.data.amount)

  await tx.tokenMint.create({
    data: {
      tokenDataId: event.data.id,
      amount: BigInt(event.data.amount),
    }
  })

  await tx.token.updateMany({
    where: {
      tokenName: tokenId.token_data_id.name,
      collection: {
        creatorAddress: tokenId.token_data_id.creator,
        collectionName: tokenId.token_data_id.collection
      }
    },
    data: {
      circulatingSupply: {
        increment: amount
      }
    }
  })

  logger.info(`Processed TokenMintEvent`)
}

async function processTokenData(event: any, tx: TransactionClient) {
  logger.debug('Processing token data', event)
  await tx.tokenData.create({
    data: {
      creator: event.data.id.creator,
      collection: event.data.id.collection,
      name: event.data.id.name,
      description: event.data.description,
      maximum: BigInt(event.data.maximum),
      uri: event.data.uri,
      royaltyPayeeAddress: event.data.royalty_payee_address,
      royaltyPointsDenominator: BigInt(event.data.royalty_points_denominator),
      royaltyPointsNumerator: BigInt(event.data.royalty_points_numerator),
      propertyKeys: event.data.property_keys.map((key: string) => key),
      propertyValues: event.data.property_values,
      propertyTypes: event.data.property_types.map((type: string) => type),
    }
  })
  logger.info(`Processed TokenDataEvent`)
}

async function processTokenCollection(event: any, tx: TransactionClient) {
  logger.debug('Processing token collection', event)
  await tx.tokenCollection.create({
    data: {
      creator: event.data.creator,
      name: event.data.collection_name,
      description: event.data.description,
      uri: event.data.uri,
      maximum: BigInt(event.data.maximum)
    }
  })
  logger.info(`Processed TokenCollectionEvent`)
}

async function processTokenDeposit(event: any, tx: TransactionClient) {
  logger.debug('Processing token deposit', event)
  
  const tokenId = event.data.id
  const accountAddress = tokenId.token_data_id.creator
  const amount = BigInt(event.data.amount)
  const propertyVersion = BigInt(tokenId.property_version)

  // Ensure account exists
  await getOrCreateAccount(accountAddress, tx)

  // Find associated token
  const token = await tx.token.findFirst({
    where: {
      tokenName: tokenId.token_data_id.name,
      collection: {
        creatorAddress: tokenId.token_data_id.creator,
        collectionName: tokenId.token_data_id.collection
      },
      propertyVersion: propertyVersion
    }
  })

  // Create deposit record
  await tx.tokenDeposit.create({
    data: {
      tokenId: event.data.id,
      amount: BigInt(event.data.amount),
      toAddress: event.guid.account_address,
    }
  })

  // Update token balance
  await tx.tokenBalance.upsert({
    where: {
      accountAddress_tokenDataId: {
        accountAddress,
        tokenDataId: tokenId.token_data_id
      }
    },
    create: {
      accountAddress,
      tokenDataId: tokenId.token_data_id,
      tokenId: token?.id, 
      balance: amount
    },
    update: {
      tokenId: token?.id, 
      balance: {
        increment: amount
      }
    }
  })

  // Record transaction with more details
  await tx.tokenTransaction.create({
    data: {
      accountAddress,
      tokenDataId: tokenId.token_data_id,
      transactionType: 'DEPOSIT',
      amount,
      toAddress: event.guid.account_address,
    }
  })

  logger.info(`Processed TokenDepositEvent`)
}

async function processTokenWithdraw(event: any, tx: TransactionClient) {
  logger.debug('Processing token withdraw', event)
  
  const tokenId = event.data.id
  const accountAddress = tokenId.token_data_id.creator
  const amount = BigInt(event.data.amount)
  const propertyVersion = BigInt(tokenId.property_version)

  // Ensure account exists
  await getOrCreateAccount(accountAddress, tx)

  const token = await tx.token.findFirst({
    where: {
      tokenName: tokenId.token_data_id.name,
      collection: {
        creatorAddress: tokenId.token_data_id.creator
      },
      propertyVersion: propertyVersion
    }
  })

  await tx.tokenWithdraw.create({
    data: {
      tokenId: event.data.id,
      amount: BigInt(event.data.amount),
      fromAddress: event.guid.account_address,
    }
  })

  // Update token balance
  await tx.tokenBalance.update({
    where: {
      accountAddress_tokenDataId: {
        accountAddress,
        tokenDataId: tokenId
      }
    },
    data: {
      tokenId: token?.id,
      balance: {
        decrement: amount
      }
    }
  })

  // Record transaction with more details
  await tx.tokenTransaction.create({
    data: {
      accountAddress,
      tokenDataId: tokenId.token_data_id,
      transactionType: 'WITHDRAW',
      amount,
      fromAddress: event.guid.account_address,
    }
  })

  logger.info(`Processed TokenWithdrawEvent`)
}

async function processLootboxStatusUpdated(event: any, tx: TransactionClient) {
  logger.debug('Processing lootbox status update', event)
  
  const collection = await tx.collection.findFirst({
    where: {
      creatorAddress: event.data.creator,
      collectionName: event.data.collection_name
    },
    include: {
      lootboxes: true
    }
  })

  if (!collection || !collection.lootboxes[0]) {
    throw new Error('Collection or Lootbox not found')
  }

  const lootbox = await tx.lootbox.update({
    where: { id: collection.lootboxes[0].id },
    data: {
      isActive: event.data.is_active,
      timestamp: BigInt(event.data.timestamp)
    }
  })

  logger.info(`Processed LootboxStatusUpdatedEvent: Lootbox ${lootbox.id} is now ${lootbox.isActive ? 'active' : 'inactive'}`)
}

// Add cleanup job for 24h analytics
export async function cleanupDayOldAnalytics(tx: TransactionClient) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  
  await tx.collectionAnalytics.updateMany({
    where: {
      updatedAt: {
        lt: oneDayAgo
      }
    },
    data: {
      volume24h: BigInt(0),
      purchases24h: 0,
      uniqueBuyers24h: 0
    }
  })
} 