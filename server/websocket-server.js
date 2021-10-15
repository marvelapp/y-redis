// @ts-ignore
import WS, { WebSocketServer } from 'ws' // eslint-disable-line
import * as yredis from './redis-helpers.js'
import * as encoding from 'lib0/encoding.js'
// import * as decoding from 'lib0/decoding.js'
import * as protocol from '../lib/protocol.js'
import { logger } from '../lib/utils.js'

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
    this.isAlive = true
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
    this._send(encoding.toUint8Array(encoder))
  }

  /**
   * @param {string} collectionid
   */
  syncedCollection (collectionid) {
    const encoder = encoding.createEncoder()
    logger('Client synced collection with backend', { collectionid })
    protocol.serverWriteSynced(encoder, collectionid)
    this._send(encoding.toUint8Array(encoder))
  }

  /**
   * @param {Uint8Array} message
   */
  _send (message) {
    this.ws.send(message)
  }

  destroy () {
    this.subs.forEach(collectionid => {
      redisConn.unlisten(this, collectionid)
    })
    this.subs.clear()
    if (!this.ws.CLOSED) {
      this.ws.terminate()
    }
    clients.delete(this)
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

const pingHandler = () => {
  clients.forEach(client => {
    if (!client.isAlive) { client.destroy() }
    client.isAlive = false
    client._send(protocol.encodePingMessage())
  })
}
setInterval(pingHandler, protocol.PING_INTERVAL)

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
