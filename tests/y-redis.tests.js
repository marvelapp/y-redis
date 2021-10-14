import * as Y from 'yjs'
import * as t from 'lib0/testing'
import * as promise from 'lib0/promise'
import Redis from 'ioredis'
import * as yredis from '../server/redis-helpers.js'
import { compareTimestamps, logger } from '../lib/utils.js'
import * as map from 'lib0/map'

const N = 1000

class TestClient {
  /**
   * @param {yredis.RedisConn} conn
   * @param {string} collectionid
  */
  constructor (conn, collectionid) {
    /**
     * @type {Map<string, Y.Doc>}
     */
    this.ydocs = new Map()
    this.yarray = this.getDoc('main-array').getArray()
    this.ymap = this.getDoc('main-map').getMap()
    this.conn = conn
    this.clock = '0'
    this.localClock = 0
    this.isConnected = false
    this.collectionid = collectionid
    this.connect()
  }

  /**
   * @param {string} docid
   */
  getDoc (docid) {
    return map.setIfUndefined(this.ydocs, docid, () => {
      const ydoc = new Y.Doc()
      /**
       * @param {Uint8Array} update
       * @param {any} origin
       */
      const onUpdate = (update, origin) => {
        if (origin !== this) {
          this.conn.publish(this.collectionid, docid, update)
        }
      }
      ydoc.on('updateV2', onUpdate)
      return ydoc
    })
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {Uint8Array} update
   * @param {string} clock
   */
  publishUpdate (collectionid, docid, update, clock) {
    if (this.collectionid === collectionid) {
      Y.applyUpdateV2(this.getDoc(docid), update, this)
      this.clock = clock
    }
  }

  /**
   * @param {string} collectionid
   */
  syncedCollection (collectionid) {
    logger('Client synced collection ', collectionid)
  }

  connect () {
    if (!this.isConnected) {
      this.conn.listen(this, this.collectionid, this.clock)
      this.isConnected = true
    }
  }

  disconnect () {
    this.conn.unlisten(this, this.collectionid)
    this.isConnected = false
  }
}

/**
 * @param {t.TestCase} tc
 * @param {boolean} [pipelining] optionally enable pipelining. For testing potential performance improvements of autopipelining which is generally supported.
 */
const init = async (tc, pipelining = false) => {
  const collectionId = tc.testName.toLowerCase()
  const redisRead = new Redis({ readOnly: true })
  // @ts-ignore
  const redisWrite = new Redis(pipelining ? { enableAutoPipelining: true, autoPipeliningIgnoredCommands: ['xtrim'] } : {})
  await redisWrite.xtrim(collectionId, 'MAXLEN', '0')
  const conn = new yredis.RedisConn(redisRead, redisWrite)
  const clients = [0, 0, 0, 0, 0].map(_ => new TestClient(conn, collectionId))
  return { conn, clients, client1: clients[0], client2: clients[1], client3: clients[2], client4: clients[3], client5: clients[4], redis: redisRead, redisWrite, collectionId }
}

/**
 * @param {Array<TestClient>} clients
 */
const compare = async clients => {
  await promise.wait(50)
  for (let i = 0; i < clients.length - 1; i++) {
    const client1 = clients[i]
    const client2 = clients[i + 1]
    t.compareArrays(client1.yarray.toArray(), client2.yarray.toArray())
    t.compareArrays(client1.ymap.toJSON(), client2.ymap.toJSON())
  }
}

/**
 * Wait until at least one update was received by any client and all clients are synced
 *
 * @param {Array<TestClient>} clients
 */
const waitForClientsSynced = clients => {
  const lowestClock = clients.map(client => client.clock).reduce((prev, next) => compareTimestamps(prev, next) ? next : prev)
  return promise.until(0, () => clients[0].clock !== lowestClock && clients.every(/** @param {TestClient} client */ client => client.clock === clients[0].clock))
}

/**
 * @param {t.TestCase} tc
 */
export const testClearDocument = async tc => {
  const { conn, client1, clients, collectionId } = await init(tc, false)
  client1.yarray.push([1])
  await waitForClientsSynced(clients)
  await conn.trim(collectionId, client1.clock)
  const client2 = new TestClient(conn, collectionId)
  client2.yarray.push([2])
  await waitForClientsSynced([...clients, client2])
  t.assert(client2.yarray.length === 1)
  t.assert(client1.yarray.length === 2)
}

/**
 * Two clients concurrently adding content
 *
 * @param {t.TestCase} tc
 */
export const testLateJoin = async tc => {
  const { client1, client3, clients, collectionId, conn } = await init(tc)
  const { clients: otherClients, client4 } = await init(tc)
  client1.yarray.insert(0, ['a'])
  client1.yarray.insert(0, ['b'])
  client3.yarray.insert(0, ['c'])
  client4.yarray.insert(0, ['d'])
  // create a fresh conn after content was inserted
  await waitForClientsSynced([...clients, ...otherClients])
  const client2 = new TestClient(conn, collectionId)
  await compare([client1, client2, ...clients, ...otherClients])
}

/**
 * Two clients from different connections can concurrently add content.
 *
 * @param {t.TestCase} tc
 */
export const testConcurrentEdit = async tc => {
  const { client1 } = await init(tc)
  const { client2 } = await init(tc)
  client1.yarray.push([1])
  client2.yarray.push([2])
  await waitForClientsSynced([client1, client2])
  await compare([client1, client2])
}

/**
 * Test time until N updates are written to redis + time to receive and apply updates.
 *
 * @param {t.TestCase} tc
 */
export const testPerformance = async tc => {
  const { client1, conn, clients, collectionId } = await init(tc)
  await t.measureTimeAsync(`write ${N / 1000}k updates`, async () => {
    const testarray = client1.yarray
    for (let i = 0; i < N; i++) {
      testarray.insert(0, [i])
    }
    await waitForClientsSynced(clients)
    t.assert(testarray.length === N)
    return undefined
  })
  const newClient = new TestClient(conn, collectionId)
  await t.measureTimeAsync(`read ${N / 1000}k updates`, async () => {
    await waitForClientsSynced([client1, newClient])
    t.assert(newClient.yarray.length === N)
    return undefined
  })
}

/**
 * Two clients concurrently adding a lot of updates. Syncing after every 10 updates.
 *
 * @param {t.TestCase} tc
 */
export const testPerformanceConcurrent = async tc => {
  const { client1, client2, conn, clients, collectionId } = await init(tc)
  await t.measureTimeAsync(`write ${N / 1000}k updates`, async () => {
    const testarray1 = client1.yarray
    const testarray2 = client2.yarray
    for (let i = 0; i < N; i++) {
      if (i % 2) {
        testarray1.insert(0, [i])
      } else {
        testarray2.insert(0, [i])
      }
      if (i % 10 === 0) {
        await waitForClientsSynced(clients)
        t.assert(testarray1.length === i + 1)
        t.assert(testarray2.length === i + 1)
      }
    }
    await waitForClientsSynced(clients)
    t.assert(testarray1.length === N)
    t.assert(testarray2.length === N)
    return undefined
  })
  await t.measureTimeAsync(`read ${N / 1000}k updates`, async () => {
    const newClient = new TestClient(conn, collectionId)
    await waitForClientsSynced([client1, newClient])
    t.compare(newClient.yarray.length, N)
    return undefined
  })
}

/**
 * Test the time until another client received all updates.
 *
 * @param {t.TestCase} tc
 */
export const testPerformanceReceive = async tc => {
  const { client1, client2, conn, clients, collectionId } = await init(tc)
  await t.measureTimeAsync(`write ${N / 1000}k updates`, async () => {
    const testarray1 = client1.yarray
    const testarray2 = client2.yarray
    for (let i = 0; i < N; i++) {
      testarray1.insert(0, [i])
    }
    await waitForClientsSynced(clients)
    t.assert(testarray1.length === N)
    t.assert(testarray2.length === N)
    return undefined
  })
  await t.measureTimeAsync(`read ${N / 1000}k updates`, async () => {
    const newClient = new TestClient(conn, collectionId)
    await waitForClientsSynced([client1, newClient])
    t.assert(newClient.yarray.length === N)
    return undefined
  })
}
