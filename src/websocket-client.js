/* eslint-env browser */

import { Observable } from 'lib0/observable'
import * as protocol from './protocol.js'
import * as Y from 'yjs'
import * as math from 'lib0/math'
import * as time from 'lib0/time'
import * as map from 'lib0/map'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'

const reconnectTimeoutBase = 1200
const maxReconnectTimeout = 2500
// @todo - this should depend on awareness.outdatedTime
const messageReconnectTimeout = 30000

/**
 * @param {RedisWebsocketProvider} provider
 */
const setupWS = provider => {
  if (provider.shouldConnect && provider.ws === null) {
    const websocket = new provider._WS(provider.url)
    websocket.binaryType = 'arraybuffer'
    provider.ws = websocket
    provider.wsconnecting = true
    provider.wsconnected = false

    websocket.onerror = error => {
      console.error('Websocket Error:', error)
    }

    websocket.onmessage = event => {
      provider.wsLastMessageReceived = time.getUnixTime()
      console.log('debugging client received message')
      protocol.clientReadMessage(decoding.createDecoder(new Uint8Array(event.data)), provider)
    }
    websocket.onclose = () => {
      provider.ws = null
      provider.wsconnecting = false
      if (provider.wsconnected) {
        provider.wsconnected = false
        provider.emit('status', [{
          status: 'disconnected'
        }])
      } else {
        provider.wsUnsuccessfulReconnects++
      }
      // Start with no reconnect timeout and increase timeout by
      // log10(wsUnsuccessfulReconnects).
      // The idea is to increase reconnect timeout slowly and have no reconnect
      // timeout at the beginning (log(1) = 0)
      setTimeout(setupWS, math.min(math.log10(provider.wsUnsuccessfulReconnects + 1) * reconnectTimeoutBase, maxReconnectTimeout), provider)
    }
    websocket.onopen = () => {
      provider.wsLastMessageReceived = time.getUnixTime()
      provider.wsconnecting = false
      provider.wsconnected = true
      provider.wsUnsuccessfulReconnects = 0
      provider.emit('status', [{
        status: 'connected'
      }])
      const encoder = encoding.createEncoder()
      protocol.clientRequestSubscriptions(encoder, provider.collections)
      websocket.send(encoding.toUint8Array(encoder))
      provider._messageCache.forEach(message => {
        websocket.send(message)
      })
      provider._messageCache.length = 0
    }

    provider.emit('status', [{
      status: 'connecting'
    }])
  }
}

/**
 * @extends Observable<any>
 */
export class RedisWebsocketProvider extends Observable {
  /**
   * @param {string} url
   * @param {object} [opts]
   * @param {typeof WebSocket} [opts.WebSocketPolyfill] Optionall provide a WebSocket polyfill
   */
  constructor (url, { WebSocketPolyfill = WebSocket } = {}) {
    super()
    this.url = url
    /**
     * @type {Map<string, { ydocs: Map<string, Y.Doc>, clock: string }>}
     */
    this.collections = new Map()
    /**
     * @type {WebSocket?}
     */
    this.ws = null
    this.wsconnected = false
    this.wsconnecting = false
    this.wsLastMessageReceived = 0
    this.wsUnsuccessfulReconnects = 0
    /**
     * Whether to connect to other peers or not
     * @type {boolean}
     */
    this.shouldConnect = true
    this._WS = WebSocketPolyfill
    /**
     * @type {Array<Uint8Array>}
     */
    this._messageCache = []

    /**
     * Listens to Yjs updates and sends them to remote peers (ws and broadcastchannel)
     *
     * @param {Uint8Array} update
     * @param {any} origin
     * @param {Y.Doc} ydoc
     */
    this._updateHandler = (update, origin, ydoc) => {
      if (origin !== this) {
        this.collections.forEach(({ ydocs }, collectionid) => {
          if (ydocs.get(ydoc.guid) === ydoc) {
            const message = protocol.encodeDocumentUpdates(collectionid, [{ docid: ydoc.guid, update }])
            this._send(message)
          }
        })
      }
    }
    this._checkInterval = /** @type {any} */ (setInterval(() => {
      if (this.wsconnected && messageReconnectTimeout < time.getUnixTime() - this.wsLastMessageReceived) {
        // no message received in a long time - not even your own awareness
        // updates (which are updated every 15 seconds)
        /** @type {WebSocket} */ (this.ws).close()
      }
    }, messageReconnectTimeout / 10))
    this.connect()
  }

  /**
   * @param {Uint8Array} message
   */
  _send (message) {
    if (this.wsconnected) {
      /** @type {WebSocket} */ (this.ws).send(message)
    } else {
      this._messageCache.push(message)
    }
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   */
  getDoc (collectionid, docid) {
    const collection = map.setIfUndefined(this.collections, collectionid, () => {
      return { clock: '0', ydocs: new Map() }
    })
    return map.setIfUndefined(collection.ydocs, docid, () => {
      const ydoc = new Y.Doc({ guid: docid })
      const encoder = encoding.createEncoder()
      const subCollections = new Map()
      ydoc.on('updateV2', this._updateHandler)
      subCollections.set(collectionid, { ydoc, clock: '0' })
      if (this.wsconnected) {
        protocol.clientRequestSubscriptions(encoder, subCollections)
        this._send(encoding.toUint8Array(encoder))
      }
      return ydoc
    })
  }

  disconnect () {
    this.shouldConnect = false
    if (this.ws !== null) {
      this.ws.close()
    }
  }

  connect () {
    this.shouldConnect = true
    if (!this.wsconnected && this.ws === null) {
      setupWS(this)
    }
  }
}
