
import { AbstractClientStorage } from './storage.js' // eslint-disable-line
import * as error from 'lib0/error' // @todo remove
import * as promise from 'lib0/promise'
import * as map from 'lib0/map'

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
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {string} clock
   * @return {Array<Uint8Array>}
   */
  getDocument (collectionid, docid, clock) {
    const updates = /** @type {Map<string, Array<{ clock: string, update: Uint8Array }>>} */ (this.collections.get(collectionid) || new Map()).get(docid) || []
    const start = updates.findIndex(update => update.clock >= clock)
    return updates.slice(start).map(update => update.update)
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
     *
    const collection = this.collections.get(collectionid) || new Map()
    const updates = collection.get(docid) || []
    */
    error.methodUnimplemented()
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {Uint8Array} update
   * @return {Promise<any>}
   */
  storePendingUpdate (collectionid, docid, update) {
    error.methodUnimplemented()
  }

  /**
   * @param {function({ collectionid: string, docid: string, update: Uint8Array, done: boolean }): void} f
   */
  iteratePendingUpdates (f) {
    error.methodUnimplemented()
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @return {Array<Uint8Array>}
   */
  getPendingDocumentUpdates (collectionid, docid) {
    error.methodUnimplemented()
  }
}
