
import Redis from 'ioredis' // eslint-disable-line no-unused-vars
import * as map from 'lib0/map'
import * as Y from 'yjs'
import * as buffer from 'lib0/buffer'
import { logger, parseTimestamp, compareTimestamps } from '../lib/utils.js'

export { Redis }

/**
 * @param {Redis.Redis | Redis.Cluster} redis
 * @param {Map<string, { clock: string, clients: Set<Client> }>} clients
 * @param {boolean} block
 */
const queryStreamUpdates = async (redis, clients, block) => {
  const arg = []
  if (block) {
    arg.push('BLOCK', 0)
  }
  arg.push('STREAMS')

  /**
   * @type {Array<string>}
   */
  const collections = []
  /**
   * @type {Array<string>}
   */
  const ids = []
  clients.forEach((collection, collectionGuid) => {
    collections.push(collectionGuid)
    ids.push(collection.clock)
  })
  arg.push(...collections)
  arg.push(...ids)
  // console.log('listening!!', arg)
  const result = await redis.xread(...arg)
  // console.log('ending listening.....', arg)
  // console.log('result', JSON.stringify(result))
  ;(result || []).forEach(stream => {
    const collectionid = stream[0]
    const entries = stream[1]
    /**
     * @type {Map<string, Array<Uint8Array>>} maps from docid to updates
     */
    const updates = new Map()
    entries.forEach(entry => {
      const vals = entry[1] // has the form [docid, update, docid, update]
      for (let i = 0; i < vals.length; i += 2) {
        const docid = vals[i]
        const update = vals[i + 1]
        map.setIfUndefined(updates, docid, () => []).push(buffer.fromBase64(update))
      }
    })
    const nextClock = entries[entries.length - 1][0]

    const collection = clients.get(collectionid)
    if (collection) {
      collection.clock = nextClock
    }
    updates.forEach((updates, docid) => {
      const update = Y.mergeUpdatesV2(updates)
      // console.log(`collection: "${collectionid}", room: "${docid}". message: "${update}", lastId: "${nextClock}"`)
      if (collection) {
        collection.clients.forEach(client => {
          client.publishUpdate(collectionid, docid, update, nextClock)
        })
      }
    })
  })
}

/**
 * @param {RedisConn} conn
 */
const queryAllStreamsInterval = async conn => {
  if (!conn.isConnected) {
    return
  }
  try {
    conn.addToCollections.forEach((entry, collectionId) => {
      const collection = map.setIfUndefined(conn.collections, collectionId, () => ({ clients: new Set(), clock: entry.clock }))
      entry.clients.forEach(client => {
        collection.clients.add(client)
      })
      // Overwrite current timestamp with older timestamp from new client
      // There is only a slight chance that this might happen. In the worst case, we pull & publish a few updates again.
      if (compareTimestamps(collection.clock, entry.clock)) {
        collection.clock = entry.clock
      }
    })
    conn.addToCollections = map.create()
    await queryStreamUpdates(conn.redisRead, conn.collections, true)
  } catch (err) {
    console.error('Error in Stream Query Interval: ' + err)
  } finally {
    queryAllStreamsInterval(conn)
  }
}

export class Client {
  /**
   * @param {string} collection
   * @param {string} docid
   * @param {Uint8Array} update
   * @param {string} clock
   */
  publishUpdate (collection, docid, update, clock) {
    logger(`collection: ${collection}, room: "${docid}". message: "${update}", confirmed clock: "${clock}"`)
  }
  /**
   * @param {string} collectionid
   */
  syncedCollection (collectionid) {
    logger(`collection ${collectionid} synced`)
  }
}

export class RedisConn {
  /**
   * @param {Redis.Cluster | Redis.Redis} redisRead
   * @param {Redis.Cluster | Redis.Redis} redisWrite
   */
  constructor (redisRead, redisWrite) {
    this.redisRead = redisRead
    this.redisWrite = redisWrite
    /**
     * Maps from collection-name to last received id.
     * @type {Map<string, { clock: string, clients: Set<Client> }>}
     */
    this.collections = new Map()
    /**
     * This collection will be added to `this.collections` when the blocking stream reader finishes.
     * @type {Map<string, { clock: string, clients: Set<Client> }>}
     */
    this.addToCollections = new Map()
    this.isConnected = true
  }

  /**
   * @return {Promise<'OK'>} Resolves when all connections have been gracefully shut down.
   */
  destroy () {
    return Promise.all([this.redisRead.quit(), this.redisWrite.quit()]).then(res => {
      this.isConnected = false
      return 'OK'
    })
  }

  /**
   * @param {Client} client
   * @param {string} collectionid
   * @param {string} startClock
   */
  listen (client, collectionid, startClock) {
    const clients = new Map()
    clients.set(collectionid, { clock: startClock, clients: new Set([client]) })
    // query initial state
    queryStreamUpdates(this.redisWrite, clients, false).then(() => {
      client.syncedCollection(collectionid)
      const collection = map.setIfUndefined(this.addToCollections, collectionid, () => ({ clock: '0', clients: new Set() }))
      collection.clients.add(client)
      if (this.collections.size === 0) {
        queryAllStreamsInterval(this)
      }
    })
  }

  /**
   * @param {Client} client
   * @param {string} collectionId
   */
  unlisten (client, collectionId) {
    /**
     * @param {Map<string, { clients: Set<Client>, clock: string }>} collections
     */
    const unregisterHelper = collections => {
      const collection = collections.get(collectionId)
      if (collection) {
        collection.clients.delete(client)
        if (collection.clients.size === 0) {
          collections.delete(collectionId)
        }
      }
    }
    unregisterHelper(this.collections)
    unregisterHelper(this.addToCollections)
  }

  /**
   * @param {string} collectionId
   * @param {string} docId
   * @param {Uint8Array} update
   * @return {Promise<string>}
   */
  publish (collectionId, docId, update) {
    return this.redisWrite.xadd(collectionId, '*', docId, buffer.toBase64(update))
  }

  /**
   * Trims collection to delete all entries with clock from [0, clock] (inklusive).
   * Call this function when you know that all entries from [0, clock] have been saved to a database.
   *
   * @param {string} collectionId
   * @param {string} clock
   * @return {Promise<number>} returns the number of evicted entries
   */
  trim (collectionId, clock) {
    const t = parseTimestamp(clock)
    return this.redisWrite.xtrim(collectionId, 'MINID', `${t[0]}-${t[1] + 1}`)
  }
}
