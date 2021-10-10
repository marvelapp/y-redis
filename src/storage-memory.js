
import { AbstractClientStorage } from './storage.js' // eslint-disable-line
import * as promise from 'lib0/promise'
import * as map from 'lib0/map'
import { parseTimestamp } from './redis-helpers.js'

/**
 * @template T
 * @param {T & Array<{ clock: string }>} updates
 * @return {T}
 */
const sortUpdates = updates => updates.sort((a, b) => a.clock < b.clock ? -1 : 1)

/**
 * @implements {AbstractClientStorage}
 */
export class MemoryStorage {
  constructor () {
    /**
     * Maps from collectionid to a Map that maps from docid to an sorted Array of updates.
     *
     * @type {Map<string, Map<string, Array<{ clock: string, update: Uint8Array }>>>}
     */
    this.collections = new Map()
    /**
     * @type {Array<{ pid: string, update: Uint8Array, collectionid: string, docid: string }>}
     */
    this.pending = []
    this.nextPid = 0
  }

  /**
   * Retrieve the latest clock for a collection.
   *
   * @param {string} collectionid
   * @return {Promise<string>}
   */
  getClock (collectionid) {
    let latest = '0'
    const collection = this.collections.get(collectionid)
    if (collection) {
      collection.forEach(updates => {
        const collectionClock = updates[updates.length - 1].clock
        if (collectionClock > latest) {
          latest = collectionClock
        }
      })
    }
    return Promise.resolve(latest)
  }

  /**
   * @param {string} collectionid
   * @return {Promise<string>}
   */
  initializeCollection (collectionid) {
    map.setIfUndefined(this.collections, collectionid, () => new Map())
    return this.getClock(collectionid)
  }

  /**
   * Update the clock of a collection. This should automatically serve as a subscription.
   *
   * @return {Promise<Array<{ collectionid: string, clock: string }>>}
   */
  getCollections () {
    return promise.all(map.map(this.collections, (collection, collectionid) => this.getClock(collectionid).then(clock => ({ clock, collectionid }))))
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {string} clock
   * @return {Promise<{ updates: Array<Uint8Array>, endClock: string }>}
   */
  getDocument (collectionid, docid, clock) {
    const updates = /** @type {Map<string, Array<{ clock: string, update: Uint8Array }>>} */ (this.collections.get(collectionid) || new Map()).get(docid) || []
    const start = updates.findIndex(update => update.clock >= clock)
    const endClock = updates.length > 0 ? updates[updates.length - 1].clock : '0'
    return Promise.resolve({ updates: updates.slice(start).map(update => update.update), endClock })
  }

  /**
   * @param {string} collectionid
   * @param {string} clock
   * @param {function(Array<{ clock: string, docid: string, update: Uint8Array }>):void} iterator
   * @return {Promise<void>}
   */
  iterateCollection (collectionid, clock, iterator) {
    /**
     * @type {Map<string, Array<{ clock: string, update: Uint8Array }>>}
     */
    const collection = this.collections.get(collectionid) || new Map()
    /**
     * @type {Array<{ clock: string, update: Uint8Array, docid: string }>}
     */
    const updates = []
    collection.forEach((docupdates, docid) => {
      docupdates.forEach(content => {
        if (content.clock >= clock) {
          updates.push({ update: content.update, docid, clock: content.clock })
        }
      })
    })
    iterator(sortUpdates(updates))
    return promise.resolve()
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {Uint8Array} update
   * @param {string} clock
   * @return {Promise<void>}
   */
  storeUpdate (collectionid, docid, update, clock) {
    const collection = map.setIfUndefined(this.collections, collectionid, () => new Map())
    const docupdates = map.setIfUndefined(collection, docid, () => [])
    const needsSort = docupdates.length > 0 && docupdates[docupdates.length - 1].clock > clock
    docupdates.push({ clock, update })
    needsSort && sortUpdates(docupdates)
    return promise.resolve()
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {Uint8Array} update
   * @param {string} startClock
   * @param {string} endClock
   */
  storeMergedUpdate (collectionid, docid, update, startClock, endClock) {
    /**
     * @type {Map<string, Array<{ clock: string, update: Uint8Array }>>}
     */
    const collection = map.setIfUndefined(this.collections, collectionid, () => new Map())
    const updates = collection.get(docid) || []
    const end = parseTimestamp(endClock)
    const start = parseTimestamp(startClock)
    const filtered = updates.filter(({ clock }) => {
      const updateClock = parseTimestamp(clock)
      return updateClock[0] < start[0] || updateClock[0] > end[0] || (updateClock[0] === end[0] && updateClock[1] > end[1])
    })
    filtered.push({ update, clock: endClock })
    collection.set(docid, filtered)
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {Uint8Array} update
   * @return {Promise<string>}
   */
  storePendingUpdate (collectionid, docid, update) {
    const pid = '' + this.nextPid++
    this.pending.push({ pid, update, collectionid, docid })
    return /** @type {Promise<string>} */ (promise.resolve(pid))
  }

  /**
   * We move an update from pending to actual message buffer after it has been acknowledged by the server.
   *
   * @param {string} pid
   */
  confirmPendingUpdate (pid) {
    const i = this.pending.findIndex(pending => pending.pid === pid)
    this.pending.splice(i, 1)
  }

  /**
   * @param {function({ collectionid: string, docid: string, update: Uint8Array }): void} f
   * @return {Promise<void>}
   */
  iteratePendingUpdates (f) {
    this.pending.forEach(pending => {
      f(pending)
    })
    return promise.resolve()
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @return {Promise<Array<Uint8Array>>}
   */
  async getPendingDocumentUpdates (collectionid, docid) {
    /**
     * @type {Array<Uint8Array>}
     */
    const updates = []
    await this.iteratePendingUpdates(pending => {
      if (pending.collectionid === collectionid && pending.docid === docid) {
        updates.push(pending.update)
      }
    })
    return updates
  }
}
