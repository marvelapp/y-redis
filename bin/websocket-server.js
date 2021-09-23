// @ts-ignore
import WS, { WebSocketServer } from 'ws' // eslint-disable-line
import * as yredis from '../src/redis-helpers.js'
import * as encoding from 'lib0/encoding.js'
// import * as decoding from 'lib0/decoding.js'
import * as protocol from '../src/protocol.js'
import { logger } from '../src/helpers.js'

const redisRead = new yredis.Redis()
const redisWrite = new yredis.Redis()

const redisConn = new yredis.RedisConn(redisRead, redisWrite)

export class ClientConn {
  /**
   * @param {WS} ws
   */
  constructor (ws) {
    this.ws = ws
    /**
     * @type {Set<string>} Subscription ids
     */
    this.subs = new Set()
  }

  /**
   * @param {string} collectionid
   * @param {string} clock
   */
  subscribe (collectionid, clock) {
    this.subs.add(collectionid)
    redisConn.listen(this, collectionid, clock)
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {Uint8Array} update
   * @param {string} clock
   */
  publishUpdate (collectionid, docid, update, clock) {
    const encoder = encoding.createEncoder()
    logger('Redis sends update to client', { collectionid, docid, clock })
    protocol.serverWriteUpdate(encoder, collectionid, docid, update, clock)
    this.ws.send(encoding.toUint8Array(encoder))
  }

  destroy () {
    this.subs.forEach(collectionid => {
      redisConn.unlisten(this, collectionid)
    })
    this.subs.clear()
  }
}

/**
 * @type {WS.Server}
 */
const wss = new WebSocketServer({
  port: 4321
  // @todo add delflation options
})

/**
 * @type {Set<ClientConn>}
 */
const clients = new Set()

wss.on('connection', ws => {
  ws.binaryType = 'arraybuffer'
  const client = new ClientConn(ws)
  clients.add(client)
  ws.on('message', /** @param {ArrayBuffer} message */ message => {
    protocol.serverReadMessage(new Uint8Array(message), redisConn, client)
  })
  ws.on('close', event => {
    client.destroy()
  })
})
