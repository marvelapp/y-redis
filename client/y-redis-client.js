/* eslint-env browser */

import { Observable } from 'lib0/observable'
import * as protocol from '../lib/protocol.js'
import * as Y from 'yjs'
import * as math from 'lib0/math'
import * as time from 'lib0/time'
import * as map from 'lib0/map'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { MemoryStorage } from '../lib/storage-memory.js'
import { logger } from '../lib/utils.js'
import { AbstractClientStorage } from '../lib/storage.js' // eslint-disable-line
import { promise } from 'lib0'

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
      logger('Client connected to server')
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
   * @param {AbstractClientStorage} [opts.storage]
   */
  constructor (url, { WebSocketPolyfill = WebSocket, storage = new MemoryStorage() } = {}) {
    super()
    this.url = url
    this.storage = storage
    /**
     * @type {Map<string, { ydocs: Map<string, Y.Doc>, clock: string }>}
     */
    this.collections = new Map()

    /**
     * @type {Map<string, { ydocs: Map<string, Y.Doc> }>}
     */
    this.loadingCollections = new Map()

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
     * Auto-subscribe to collections in the storage provider
     */
    this.storage.getCollections().then(clocks => {
      const encoder = encoding.createEncoder()
      const subCollections = new Map()
      clocks.forEach(({ clock, collectionid }) => {
        subCollections.set(collectionid, { clock })
        map.setIfUndefined(this.collections, collectionid, () => ({ ydocs: new Map(), clock }))
      })
      if (this.wsconnected) {
        protocol.clientRequestSubscriptions(encoder, subCollections)
        this._send(encoding.toUint8Array(encoder))
      }
    })

    /**
     * Listens to Yjs updates and sends them to remote peers (ws and broadcastchannel)
     *
     * @param {Uint8Array} update
     * @param {any} origin
     * @param {Y.Doc} ydoc
     */
    this._updateHandler = (update, origin, ydoc) => {
      if (origin !== this) {
        /**
         * @param {{ ydocs: Map<string, Y.Doc> }} collection
         * @param {string} collectionid
         */
        const checkPublishUpdate = ({ ydocs }, collectionid) => {
          if (ydocs.get(ydoc.guid) === ydoc) {
            this.storage.storePendingUpdate(collectionid, ydoc.guid, update).then(pendingid => {
              const message = protocol.encodeDocumentUpdates(collectionid, [{ docid: ydoc.guid, update, pendingid }])
              this._send(message)
            })
          }
        }
        this.collections.forEach(checkPublishUpdate)
        this.loadingCollections.forEach(checkPublishUpdate)
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
   */
  subscribeCollection (collectionid) {
    this.collections.get(collectionid) || map.setIfUndefined(this.loadingCollections, collectionid, () => {
      const ydocs = new Map()
      const collection = { ydocs }
      this.storage.initializeCollection(collectionid).then(clock => {
        logger('Initialized collection', { collectionid }, 'from storage')
        this.collections.set(collectionid, { ydocs: ydocs, clock })
        this.loadingCollections.delete(collectionid)
        // now subscribe to updates on collection
        const encoder = encoding.createEncoder()
        const subCollections = new Map()
        subCollections.set(collectionid, { clock })
        if (this.wsconnected) {
          protocol.clientRequestSubscriptions(encoder, subCollections)
          this._send(encoding.toUint8Array(encoder))
        }
      })
      return collection
    })
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   */
  getDoc (collectionid, docid) {
    this.subscribeCollection(collectionid) // sets the collection on either this.collections or this.loadingCollections
    const ydocs = /** @type { { ydocs: Map<string, Y.Doc> } } */ (this.collections.get(collectionid) || this.loadingCollections.get(collectionid)).ydocs
    return map.setIfUndefined(ydocs, docid, () => {
      const ydoc = new Y.Doc({ guid: docid })
      const docUpdates = this.storage.getDocument(collectionid, docid, '0')
      const pendingUpdates = this.storage.getPendingDocumentUpdates(collectionid, docid)
      promise.all(/** @type {any} */ ([docUpdates, pendingUpdates])).then(([dupdates, pupdates]) => {
        ydoc.transact(() => {
          dupdates.updates.forEach(/** @param {Uint8Array} update */ update => {
            Y.applyUpdateV2(ydoc, update)
          })
          pupdates.forEach(/** @param {Uint8Array} update */ update => {
            Y.applyUpdateV2(ydoc, update)
          })
        }, this)
        return this.storage.storeMergedUpdate(collectionid, docid, Y.encodeStateAsUpdateV2(ydoc), '0', dupdates.endClock)
      })
      ydoc.on('updateV2', this._updateHandler)

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
