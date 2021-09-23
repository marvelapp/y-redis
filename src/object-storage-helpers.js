import * as err from 'lib0/error'

export class AbstractObjectStorage {
  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {string} clock
   * @return {Promise<{ update: Uint8Array, currClock: string }>}
   */
  retrieveDoc (collectionid, docid, clock) {
    err.methodUnimplemented()
  }

  /**
   * @param {string} collectionid
   * @param {string} clock
   * @return {Promise<{ updates: Array<{ update: Uint8Array, docid: string, clock: string }>, nextClock: string, done: boolean}>}
   */
  retrieveCollection (collectionid, clock) {
    err.methodUnimplemented()
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {Uint8Array} update
   * @param {string} clock
   * @return {Promise<void>}
   */
  persist (collectionid, docid, update, clock) {
    err.methodUnimplemented()
  }
}

export class MemoryObjectStorage {
  constructor () {
    /**
     * Maps from collection-id to the Map that contains document-updates and their associated clock
     * @type {Map<string, Map<string, { clock: string, update: Uint8Array }>>}
     */
    this.collections = new Map()
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {string} clock
   * @return {Promise<{ update: Uint8Array, currClock: string }>}
   */
  retrieveDoc (collectionid, docid, clock) {
    err.methodUnimplemented()
  }

  /**
   * @param {string} collectionid
   * @param {string} clock
   * @return {Promise<{ updates: Array<{ update: Uint8Array, docid: string, clock: string }>, nextClock: string, done: boolean}>}
   */
  retrieveCollection (collectionid, clock) {
    err.methodUnimplemented()
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {Uint8Array} update
   * @param {string} clock
   * @return {Promise<void>}
   */
  persist (collectionid, docid, update, clock) {
    err.methodUnimplemented()
  }
}
