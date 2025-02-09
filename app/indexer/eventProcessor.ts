import prismadb from '@/lib/prismadb'
import { createLogger } from './utils'
import { deserializeVectorU8 } from './utils'
import cron from 'node-cron'

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

export async function processEvents(events: any[], tx: TransactionClient, blockHeight: number = 0) {
  logger.debug(`Processing ${events.length} events`)
  
  // Batch create event tracking records
  await tx.eventTracking.createMany({
    data: events.map(event => ({
      eventType: event.type,
      blockHeight: blockHeight,
      transactionHash: event.transactionHash || '',
      processed: false,
      error: null
    }))
  })

  // Group similar events together
  const depositEvents = events.filter(e => e.type === `${TOKEN_MODULE_PATH}::DepositEvent`)
  const withdrawEvents = events.filter(e => e.type === `${TOKEN_MODULE_PATH}::WithdrawEvent`)
  const otherEvents = events.filter(e => 
    e.type !== `${TOKEN_MODULE_PATH}::DepositEvent` && 
    e.type !== `${TOKEN_MODULE_PATH}::WithdrawEvent`
  )

  try {
    // Process batches of similar events
    if (depositEvents.length > 0) {
      await processBatchTokenDeposits(depositEvents, tx)
    }
    
    if (withdrawEvents.length > 0) {
      await processBatchTokenWithdraws(withdrawEvents, tx)
    }

    // Process other events sequentially
    for (const event of otherEvents) {
      await processEvent(event, tx)
    }

    // Batch update event tracking
    await tx.eventTracking.updateMany({
      where: {
        blockHeight: {
          in: events.map(e => blockHeight)
        },
        processed: false
      },
      data: {
        processed: true
      }
    })

  } catch (error) {
    logger.error(`Failed to process events:`, error)
  }
}

async function processBatchTokenDeposits(events: any[], tx: TransactionClient) {
  // Collect unique addresses and tokens needed
  const addresses = new Set(events.map(e => e.guid.account_address))
  const tokenQueries = new Set(events.map(e => JSON.stringify({
    name: e.data.id.token_data_id.name,
    creator: e.data.id.token_data_id.creator,
    collection: e.data.id.token_data_id.collection
  })))

  // Batch fetch all needed accounts and tokens
  const [accounts, tokens] = await Promise.all([
    tx.account.findMany({
      where: {
        address: {
          in: Array.from(addresses)
        }
      }
    }),
    tx.token.findMany({
      where: {
        OR: Array.from(tokenQueries).map(q => {
          const parsed = JSON.parse(q)
          return {
            tokenName: parsed.name,
            tokenCollection: {
              creator: parsed.creator,
              name: parsed.collection
            },
            propertyVersion: BigInt(0)
          }
        })
      },
      include: {
        tokenCollection: true
      }
    })
  ])

  // Create missing accounts in batch
  const existingAddresses = new Set(accounts.map(a => a.address))
  const missingAddresses = Array.from(addresses).filter(addr => !existingAddresses.has(addr))
  
  if (missingAddresses.length > 0) {
    await tx.account.createMany({
      data: missingAddresses.map(address => ({ address })),
      skipDuplicates: true
    })
  }

  // Prepare batch operations
  const deposits = events.map(event => ({
    tokenId: event.data.id,
    amount: BigInt(event.data.amount),
    toAddress: event.guid.account_address,
  }))

  const balanceUpdates = events.map(event => ({
    accountAddress: event.guid.account_address,
    tokenDataId: event.data.id.token_data_id,
    propertyVersion: BigInt(event.data.id.property_version),
    amount: BigInt(event.data.amount)
  }))

  // Execute batch operations
  await Promise.all([
    tx.tokenDeposit.createMany({
      data: deposits
    }),
    ...balanceUpdates.map(update => 
      tx.tokenBalance.upsert({
        where: {
          accountAddress_tokenDataId_propertyVersion: {
            accountAddress: update.accountAddress,
            tokenDataId: update.tokenDataId,
            propertyVersion: update.propertyVersion
          }
        },
        create: {
          accountAddress: update.accountAddress,
          tokenDataId: update.tokenDataId,
          propertyVersion: update.propertyVersion,
          balance: update.amount,
          tokenId: tokens.find(t => 
            t.tokenName === update.tokenDataId.name && 
            t.tokenCollection.creator === update.tokenDataId.creator
          )?.id
        },
        update: {
          balance: {
            increment: update.amount
          }
        }
      })
    ),
    tx.tokenTransaction.createMany({
      data: events.map(event => ({
        accountAddress: event.guid.account_address,
        tokenDataId: event.data.id.token_data_id,
        transactionType: 'DEPOSIT',
        amount: BigInt(event.data.amount),
        toAddress: event.guid.account_address,
      }))
    })
  ])

  logger.info(`Processed ${events.length} TokenDepositEvents in batch`)
}

async function processBatchTokenWithdraws(events: any[], tx: TransactionClient) {
  // Collect unique addresses and tokens needed
  const addresses = new Set(events.map(e => e.guid.account_address))
  const tokenQueries = new Set(events.map(e => JSON.stringify({
    name: e.data.id.name,
    creator: e.data.id.token_data_id.creator
  })))

  // Batch fetch all needed accounts and tokens
  const [accounts, tokens] = await Promise.all([
    tx.account.findMany({
      where: {
        address: {
          in: Array.from(addresses)
        }
      }
    }),
    tx.token.findMany({
      where: {
        OR: Array.from(tokenQueries).map(q => {
          const parsed = JSON.parse(q)
          return {
            tokenName: parsed.name,
            tokenCollection: {
              creator: parsed.creator,
              name: parsed.collection
            },
            propertyVersion: BigInt(0)
          }
        })
      },
      include: {
        tokenCollection: true
      }
    })
  ])

  // Create missing accounts in batch
  const existingAddresses = new Set(accounts.map(a => a.address))
  const missingAddresses = Array.from(addresses).filter(addr => !existingAddresses.has(addr))
  
  if (missingAddresses.length > 0) {
    await tx.account.createMany({
      data: missingAddresses.map(address => ({ address })),
      skipDuplicates: true
    })
  }

  // Prepare batch operations
  const withdraws = events.map(event => ({
    tokenId: event.data.id,
    amount: BigInt(event.data.amount),
    fromAddress: event.guid.account_address,
  }))

  const balanceUpdates = events.map(event => ({
    accountAddress: event.guid.account_address,
    tokenDataId: event.data.id.token_data_id,
    propertyVersion: BigInt(event.data.id.property_version),
    amount: BigInt(event.data.amount)
  }))

  // Execute batch operations
  await Promise.all([
    tx.tokenWithdraw.createMany({
      data: withdraws
    }),
    ...balanceUpdates.map(update => 
      tx.tokenBalance.update({
        where: {
          accountAddress_tokenDataId_propertyVersion: {
            accountAddress: update.accountAddress,
            tokenDataId: update.tokenDataId,
            propertyVersion: update.propertyVersion
          }
        },
        data: {
          tokenId: tokens.find(t => 
            t.tokenName === update.tokenDataId.name && 
            t.tokenCollection.creator === update.tokenDataId.creator
          )?.id,
          balance: {
            decrement: update.amount
          }
        }
      })
    ),
    tx.tokenTransaction.createMany({
      data: events.map(event => ({
        accountAddress: event.guid.account_address,
        tokenDataId: event.data.id.token_data_id,
        transactionType: 'WITHDRAW',
        amount: BigInt(event.data.amount),
        fromAddress: event.guid.account_address,
      }))
    })
  ])

  logger.info(`Processed ${events.length} TokenWithdrawEvents in batch`)
}

async function processEvent(event: any, tx: TransactionClient) {
  try {
    logger.debug(`Processing event of type ${event.type}`)

    switch (event.type) {
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
        await processTokenDepositOptimized(event, tx)
        break
      case `${TOKEN_MODULE_PATH}::WithdrawEvent`:
        await processTokenWithdrawOptimized(event, tx)
        break
      case `${MODULE_PATH}::LootboxStatusUpdatedEvent`:
        await processLootboxStatusUpdated(event, tx)
        break
      case `${TOKEN_MODULE_PATH}::MutateTokenPropertyMapEvent`:
        await processTokenPropertyMutation(event, tx)
        break
      default:
        logger.warn(`Unknown event type: ${event.type}`)
    }

  } catch (error) {
    // Single error tracking create
    await tx.eventTracking.create({
      data: {
        eventType: 'ERROR',
        blockHeight: BigInt(event.blockHeight || 0),
        transactionHash: event.transactionHash || '',
        processed: false,
        error: error instanceof Error ? error.message : String(error),
      }
    })
    
    logger.error(`Failed to process event:`, error)
    throw error
  }
}

async function generateUniqueUrl(collectionName: string, tx: TransactionClient): Promise<string> {
  const baseUrl = collectionName.toLowerCase().replace(/\s+/g, '-');
  const MAX_ATTEMPTS = 5;
  
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    // Generate 6-digit random number
    const randomId = Math.floor(100000 + Math.random() * 900000);
    const newUrl = `${baseUrl}-${randomId}`;
    
    const exists = await tx.oFFChain_LootboxStats.findUnique({
      where: { url: newUrl }
    });
    
    if (!exists) return newUrl;
  }
  
  throw new Error('Failed to generate unique URL after maximum attempts');
}

async function processLootboxCreated(event: any, tx: TransactionClient) {
  logger.debug('Processing lootbox creation', event)
  
  try {
    const creatorAddress = event.data.creator;
    const collectionName = deserializeVectorU8(event.data.collection_name);
    const collectionDescription = deserializeVectorU8(event.data.collection_description);
    const metadataUri = deserializeVectorU8(event.data.collection_uri);
    
    // Try to find existing token collection
    const existingCollection = await tx.tokenCollection.findFirst({
      where: {
        creator: event.data.collection_management_resource_address,
        name: collectionName
      }
    });

    if(existingCollection) {
      logger.debug(`Found existing token collection: ${existingCollection.id}`)
    }

    const lootbox = await tx.lootbox.create({
      data: {
        creatorAddress,
        collectionName,
        collectionResourceAddress: event.data.collection_management_resource_address,
        collectionDescription,
        metadataUri,
        tokenCollectionId: existingCollection?.id, // Link if exists
        price: BigInt(event.data.price),
        priceCoinType: event.data.price_coinType,
        maxStock: BigInt(event.data.max_stock),
        availableStock: BigInt(event.data.initial_stock),
        isActive: event.data.is_active,
        isWhitelisted: event.data.is_whitelist_mode,
        autoTriggerWhitelistTime: BigInt(event.data.auto_trigger_whitelist_time),
        autoTriggerActiveTime: BigInt(event.data.auto_trigger_active_time),
        timestamp: BigInt(event.data.timestamp),
        totalVolume: BigInt(0),
        purchaseCount: 0
      }
    });

    

    logger.debug('Lootbox created:', lootbox)
    logger.info(`Processed LootboxCreatedEvent: ${lootbox.id}`)
    
    return lootbox;
  } catch (error) {
    logger.error('Failed to create lootbox:', error)
    throw error
  }
}

// Add a new function to link TokenCollection when it's created
async function linkTokenCollectionToLootbox(
  creator: string, 
  collectionName: string, 
  tokenCollectionId: number, 
  tx: TransactionClient
) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000;

  for (let i = 0; i < MAX_RETRIES; i++) {
    const lootbox = await tx.lootbox.findFirst({
      where: {
        collectionResourceAddress: creator,
        collectionName: collectionName
      }
    });

    if (lootbox) {
      await tx.lootbox.update({
        where: { id: lootbox.id },
        data: { tokenCollectionId }
      });
      return;
    }

    logger.debug(`Lootbox not found, retry ${i + 1}/${MAX_RETRIES}`)
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
  }

  logger.warn('Lootbox not found after retries')
  throw new Error('Lootbox not found after retries')
}

async function processLootboxPurchaseInitiated(event: any, tx: TransactionClient) {
  const lootbox = await tx.lootbox.findFirst({
    where: {
      creatorAddress: event.data.creator,
      collectionName: event.data.collection_name
    }
  })

  if (!lootbox) {
    throw new Error('Lootbox not found')
  }

  // Ensure buyer account exists
  await getOrCreateAccount(event.data.buyer, tx)

  const purchase = await tx.lootboxPurchase.create({
    data: {
      lootboxId: lootbox.id,
      buyerAddress: event.data.buyer,
      quantity: BigInt(event.data.quantity),
      nonce: String(event.data.nonce),
      price: BigInt(event.data.price),
      priceCoinType: event.data.price_coinType,
    }
  })

  // Update lootbox stock
  tx.lootbox.update({
    where: { id: lootbox.id },
    data: {
      availableStock: {
        decrement: BigInt(event.data.quantity)
      }
    }
  }),

  // Update lootbox analytics
  await tx.lootboxAnalytics.upsert({
    where: { lootboxId: lootbox.id },
    create: {
      lootboxId: lootbox.id,
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
  const lootbox = await tx.lootbox.findFirst({
    where: {
      creatorAddress: event.data.creator,
      collectionName: event.data.collection_name
    }
  })

  if (!lootbox) {
    throw new Error('Lootbox not found')
  }

  // Create rarities in batch
  const rarities = await Promise.all(
    event.data.rarity_names.map((name: string, index: number) =>
      tx.rarity.create({
        data: {
          lootboxId: lootbox.id,
          rarityName: name,
          weight: BigInt(event.data.weights[index])
        }
      })
    )
  )
  logger.info(`Processed RaritiesSetEvent: ${rarities.length} rarities`)
}

//Lootbox Version of Token Adding.
async function processTokenAdded(event: any, tx: TransactionClient) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000; // 1 second


    const lootbox = await tx.lootbox.findFirst({
      where: {
        creatorAddress: event.data.creator,
        collectionName: event.data.collection_name
      },
      include: {
        rarities: true
      }
    })
    let tokenCollectionId : number | undefined;
    let rarity;
    let id : number | undefined;

    if (lootbox) {
      if(lootbox.tokenCollectionId === null) {
        const existingCollection = await tx.tokenCollection.findFirst({
          where: {
            creator: event.data.creator,
            name: event.data.collection_name
          }
        });

        if(existingCollection) {
          logger.debug(`Found existing token collection: ${existingCollection.id}`)
          linkTokenCollectionToLootbox(lootbox.collectionResourceAddress, lootbox.collectionName, existingCollection?.id, tx)
          tokenCollectionId = existingCollection?.id;
        }
      }

      if(tokenCollectionId === null && lootbox.tokenCollectionId === undefined) {
        throw new Error('Token collection not found')
      }

      if(tokenCollectionId) {
        id = tokenCollectionId;
      }
      if(lootbox.tokenCollectionId) {
        id = lootbox.tokenCollectionId;
      }
      if(!id) {
        throw new Error('Token collection not found')
      }
      rarity = lootbox.rarities.find(r => r.rarityName === event.data.rarity)
    }
    else {
      const existingCollection = await tx.tokenCollection.findFirst({
        where: {
          creator: event.data.creator,
          name: event.data.collection_name
        }
      });
      id = existingCollection?.id;
    }

    if(!id) {
      throw new Error('Token collection not found');
    }

    const token = await tx.token.update({
      where: {
        tokenCollectionId_tokenName_propertyVersion: {
          tokenCollectionId: id,
          tokenName: event.data.token_name,
          propertyVersion: BigInt(0),
        }
      },
      data: {
        rarityId: rarity?.id,
      }
    })

    /*const token = await tx.token.create({
      data: {
        tokenCollectionId: id,
        tokenName: event.data.token_name,
        tokenUri: event.data.token_uri,
        rarityId: rarity?.id,
        maxSupply: BigInt(event.data.max_supply),
        circulatingSupply: BigInt(0),
        tokensBurned: BigInt(0),
        propertyVersion: BigInt(0),
      }
    })*/
    logger.info(`Processed TokenAddedEvent: ${token.id}`)
    return;
  

  throw new Error('Rarity not found after retries')
}

async function processPriceUpdated(event: any, tx: TransactionClient) {
  logger.debug('Processing price update', event)
  const lootbox = await tx.lootbox.findFirst({
    where: {
      creatorAddress: event.data.creator,
      collectionName: event.data.collection_name
    }
  })

  if (!lootbox) {
    throw new Error('Lootbox not found')
  }

  await tx.lootbox.update({
    where: { id: lootbox.id },
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
  const accountAddress = tokenId.id.creator
  const amount = BigInt(event.data.amount)
  const propertyVersion = BigInt(tokenId.property_version)

  await tx.tokenBurn.create({
    data: {
      tokenId: event.data.token_id,
      amount: BigInt(event.data.amount),
      fromAddress: event.guid.account_address,
    }
  })

  const token = await tx.token.findFirst({
    where: {
      tokenName: tokenId.token_data_id.name,
      tokenCollection: {
        creator: tokenId.token_data_id.creator,
        name: tokenId.token_data_id.collection
      },
      propertyVersion: BigInt(0) // Always query for base token
    }
  })

  await tx.token.updateMany({
    where: {
      tokenName: tokenId.name,
      tokenCollection: {
        creator: tokenId.creator,
        name: tokenId.collection
      },
      propertyVersion: 0
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

  /*await tx.token.updateMany({
    where: {
      tokenName: tokenId.name,
      collection: {
        creatorAddress: tokenId.creator,
        collectionName: tokenId.collection
      }
    },
    data: {
      circulatingSupply: {
        increment: amount
      }
    }
  })*/
  // First find the token to verify it exists
  const token = await tx.token.findFirst({
    where: {
      tokenName: tokenId.name,
      tokenCollection: {
        creator: tokenId.creator,
        name: tokenId.collection
      }
    }
  })

  // Update with better error handling
  const updateResult = await tx.token.updateMany({
    where: {
      tokenName: tokenId.name,
      tokenCollection: {
        creator: tokenId.creator,
        name: tokenId.collection
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

      // Find or create token collection first
  const tokenCollection = await tx.tokenCollection.findFirst({
    where: {
      creator: event.data.id.creator,
      name: event.data.id.collection
    }
  })

  if (!tokenCollection) {
    throw new Error('Token collection not found')
  }

  // Create base token with token data properties
  await tx.token.create({
    data: {
      tokenName: event.data.id.name,
      tokenUri: event.data.uri,
      maxSupply: BigInt(event.data.maximum),
      circulatingSupply: BigInt(0),
      tokensBurned: BigInt(0),
      description: event.data.description,
      royaltyPayeeAddress: event.data.royalty_payee_address,
      royaltyPointsDenominator: BigInt(event.data.royalty_points_denominator),
      royaltyPointsNumerator: BigInt(event.data.royalty_points_numerator),
      propertyKeys: event.data.property_keys,
      propertyValues: event.data.property_values,
      propertyTypes: event.data.property_types,
      mutabilityConfig: event.data.mutability_config,
      tokenCollectionId: tokenCollection.id,
      propertyVersion: BigInt(0)
    }
  })

  //TODO: Deprecated way of storing token data. Now moved to Token model
    /*await tx.tokenData.create({
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
    })*/
  logger.info(`Processed TokenDataEvent`)
}

async function processTokenCollection(event: any, tx: TransactionClient) {
  logger.debug('Processing token collection', event)
  
  const tokenCollection = await tx.tokenCollection.create({
    data: {
      creator: event.data.creator,
      name: event.data.collection_name,
      description: event.data.description,
      uri: event.data.uri,
      maximum: BigInt(event.data.maximum)
    }
  })

  // Try to find and link existing lootbox
  const existingLootbox = await tx.lootbox.findFirst({
    where: {
      collectionResourceAddress: event.data.creator,
      collectionName: event.data.collection_name
    }
  });

  if (existingLootbox) {
    await tx.lootbox.update({
      where: { id: existingLootbox.id },
      data: { tokenCollectionId: tokenCollection.id }
    });
    logger.debug(`Linked existing lootbox to token collection: ${existingLootbox.id}`)
  }

  logger.info(`Processed TokenCollectionEvent`)
}

async function processTokenDepositOptimized(event: any, tx: TransactionClient) {
  const tokenId = event.data.id
  const toAddress = event.guid.account_address
  const amount = BigInt(event.data.amount)
  const propertyVersion = BigInt(tokenId.property_version)

  // Run independent operations in parallel
  const [account, token] = await Promise.all([
    getOrCreateAccount(toAddress, tx),
    tx.token.findFirst({
      where: {
        tokenName: tokenId.token_data_id.name,
        tokenCollection: {
          creator: tokenId.token_data_id.creator,
          name: tokenId.token_data_id.collection
        },
        propertyVersion: BigInt(0)
      }
    })
  ])

  if (!token) {
    throw new Error(`Base token not found for deposit: ${JSON.stringify(tokenId.token_data_id)}`)
  }

  // Run deposit record and balance update in parallel
  await Promise.all([
    tx.tokenDeposit.create({
      data: {
        tokenId: event.data.id,
        amount: amount,
        toAddress: toAddress,
      }
    }),
    tx.tokenBalance.upsert({
      where: {
        accountAddress_tokenDataId_propertyVersion: {
          accountAddress: toAddress,
          tokenDataId: tokenId.token_data_id,
          propertyVersion: propertyVersion
        }
      },
      create: {
        accountAddress: toAddress,
        tokenDataId: tokenId.token_data_id,
        tokenId: token.id,
        propertyVersion: propertyVersion,
        balance: amount
      },
      update: {
        tokenId: token.id,
        balance: {
          increment: amount
        }
      }
    }),
    tx.tokenTransaction.create({
      data: {
        accountAddress: toAddress,
        tokenDataId: tokenId.token_data_id,
        transactionType: 'DEPOSIT',
        amount,
        toAddress: toAddress,
      }
    })
  ])

  logger.info(`Processed TokenDepositEvent`)
}

async function processTokenWithdrawOptimized(event: any, tx: TransactionClient) {
  logger.debug('Processing token withdraw', event)
  
  const tokenId = event.data.id
  const fromAddress = event.guid.account_address // Address tokens are being withdrawn from
  const amount = BigInt(event.data.amount)
  const propertyVersion = BigInt(tokenId.property_version)

  // Run independent operations in parallel
  const [account, token] = await Promise.all([
    getOrCreateAccount(fromAddress, tx),
    tx.token.findFirst({
      where: {
        tokenName: tokenId.name,
        tokenCollection: {
          creator: tokenId.token_data_id.creator
        },
        propertyVersion: BigInt(0)
      }
    })
  ])

  // Check if balance record exists before proceeding
  const balanceRecord = await tx.tokenBalance.findUnique({
    where: {
      accountAddress_tokenDataId_propertyVersion: {
        accountAddress: fromAddress,
        tokenDataId: tokenId.token_data_id,
        propertyVersion: propertyVersion
      }
    }
  });

  if (!balanceRecord) {
    await tx.eventTracking.create({
      data: {
        eventType: 'ERROR',
        blockHeight: BigInt(event.blockHeight || 0),
        transactionHash: event.transactionHash || '',
        processed: false,
        error: `Missing token balance record for withdrawal: account ${fromAddress}, token ${JSON.stringify(tokenId.token_data_id)} ${JSON.stringify(tokenId.property_version)} ${JSON.stringify(fromAddress)} ${JSON.stringify(amount.toString())}`,
      }
    });
    logger.error('Base token not found for withdrawal');
    return;
  }

  // Run withdraw record and balance update in parallel
  await Promise.all([
    tx.tokenWithdraw.create({
      data: {
        tokenId: event.data.id,
        amount: BigInt(event.data.amount),
        fromAddress: fromAddress,
      }
    }),
    tx.tokenBalance.update({
      where: {
        accountAddress_tokenDataId_propertyVersion: {
          accountAddress: fromAddress,
          tokenDataId: tokenId.token_data_id,
          propertyVersion: propertyVersion
        }
      },
      data: {
        tokenId: token?.id,
        balance: {
          decrement: amount
        }
      }
    }),
    tx.tokenTransaction.create({
      data: {
        accountAddress: fromAddress,
        tokenDataId: tokenId.token_data_id,
        transactionType: 'WITHDRAW',
        amount,
        fromAddress: fromAddress,
      }
    })
  ])

  logger.info(`Processed TokenWithdrawEvent`)
}

async function processLootboxStatusUpdated(event: any, tx: TransactionClient) {
  logger.debug('Processing lootbox status update', event)
  
  const lootbox = await tx.lootbox.findFirst({
    where: {
      creatorAddress: event.data.creator,
      collectionName: event.data.collection_name
    }
  })

  if (!lootbox) {
    throw new Error('Lootbox not found')
  }

  await tx.lootbox.update({
    where: { id: lootbox.id },
    data: {
      isActive: event.data.is_active,
      isWhitelisted: event.data.is_whitelist_mode,
      autoTriggerWhitelistTime: BigInt(event.data.auto_trigger_whitelist_time),
      autoTriggerActiveTime: BigInt(event.data.auto_trigger_active_time),
      timestamp: BigInt(event.data.timestamp)
    }
  })

  logger.info(`Processed LootboxStatusUpdatedEvent: Lootbox ${lootbox.id} is now ${lootbox.isActive ? 'active' : 'inactive'}`)
}

// Add cleanup job for 24h analytics
export async function cleanupDayOldAnalytics(tx: TransactionClient) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  
  await tx.lootboxAnalytics.updateMany({
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

async function processTokenPropertyMutation(event: any, tx: TransactionClient) {
  logger.debug('Processing token property mutation', event)
  
  const oldTokenId = event.data.old_id
  const newTokenId = event.data.new_id
  
  // Find the base token (property_version 0)
  const baseToken = await tx.token.findFirst({
    where: {
      tokenName: oldTokenId.token_data_id.name,
      tokenCollection: {
        creator: oldTokenId.token_data_id.creator,
        name: oldTokenId.token_data_id.collection
      },
      propertyVersion: BigInt(0) // Base version
    }
  })

  if (!baseToken) {
    logger.error('Base token not found for property mutation', oldTokenId)
    return
  }

  // Create or update property map
  await tx.propertyMap.upsert({
    where: {
      tokenId_propertyVersion: {
        tokenId: baseToken.id,
        propertyVersion: BigInt(newTokenId.property_version)
      }
    },
    create: {
      tokenId: baseToken.id,
      propertyVersion: BigInt(newTokenId.property_version),
      keys: event.data.keys,
      values: event.data.values,
      types: event.data.types
    },
    update: {
      keys: event.data.keys,
      values: event.data.values,
      types: event.data.types
    }
  })

  logger.info(`Processed MutateTokenPropertyMapEvent`)
}

export async function cleanupOldEventTracking(tx: TransactionClient, retentionDays: number = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  try {
    const result = await tx.eventTracking.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate
        },
        // Optionally, only delete processed events
        processed: true
      }
    });

    logger.info(`Cleaned up ${result.count} old event tracking records`);
    return result.count;
  } catch (error) {
    logger.error('Failed to cleanup old event tracking:', error);
    throw error;
  }
}

// Run daily at midnight
//cron.schedule('0 0 * * *', async () => {
//  const tx = await prismadb.$transaction(async (tx) => {
//    await cleanupOldEventTracking(tx);
//  });
//}); 