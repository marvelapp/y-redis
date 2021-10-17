/* eslint-env browser */

import { AbstractClientStorage } from './storage.js' // eslint-disable-line
import { compareTimestamps, parseTimestamp } from '../lib/utils.js'
import * as promise from 'lib0/promise'
import * as map from 'lib0/map'
import * as idb from 'lib0/indexeddb'

/**
 * @template T
 * @param {T & Array<{ clock: string }>} updates
 * @return {T}
 */
const sortUpdates = updates => updates.sort((a, b) => a.clock < b.clock ? -1 : 1)

/**
 * @implements {AbstractClientStorage}
 */
export class IndexeddbStorage {
  constructor () {
    this._db = idb.openDB('y-redis', db =>
      idb.createStores(db, [
        ['pending', { autoIncrement: true }],
        ['updates'],
        ['clocks'],
        ['custom']
      ])
    )
  }

  /**
   * Retrieve the latest clock for a collection.
   *
   * @param {string} collectionid
   * @return {Promise<string>}
   */
  getClock (collectionid) {
    return this._db.then(db => {
      const [clocks] = idb.transact(db, ['updates', 'clocks'])
      return idb.get(clocks, collectionid).then(clock => /** @type {string} */ (clock) || '0')
    })
  }

  /**
   * @param {string} collectionid
   * @return {Promise<string>}
   */
  initializeCollection (collectionid) {
    return this._db.then(db => {
      const [clocks] = idb.transact(db, ['clocks'])
      return idb.put(clocks, collectionid, '0')
    })
  }

  /**
   * Update the clock of a collection. This should automatically serve as a subscription.
   *
   * @return {Promise<Array<{ collectionid: string, clock: string }>>}
   */
  getCollections () {
    return this._db.then(db => {
      const [clocks] = idb.transact(db, ['clocks'])
      return idb.getAllKeysValues(clocks).then(kv => {
        return kv.map(p => ({ collectionid: p.k, clock: p.v }))
      })
    })
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {string} clock
   * @return {Promise<{ updates: Array<Uint8Array>, endClock: string }>}
   */
  getDocument (collectionid, docid, clock) {
    return this._db.then(db => {
      const [updates] = idb.transact(db, ['updates'])
      const range = idb.createIDBKeyRangeBound(`${collectionid}#${docid}#${clock}`, `${collectionid}#${docid}#Z`, true, false)
      return promise.all([idb.getAll(updates, range), idb.queryFirst(updates, range, 'prev')]).then(([updates, endClock]) => {
        return ({ updates, endClock })
      })
    })
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
    return this._db.then(db => {
      const [updates, clocks] = idb.transact(db, ['updates', 'clocks'])
      promise.all([idb.put(updates, update, `${collectionid}#${docid}#${clock}`), idb.get(clocks, collectionid)]).then(([_, clock]) => {
        if (!compareTimestamps(clock || '0', clock)) {
          return idb.put(clocks, clock, collectionid)
        }
      })
    })
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
