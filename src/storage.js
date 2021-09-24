import * as error from 'lib0/error'

/**
 * @interface
 */
export class AbstractObjectStorage {
  /**
   * Retrieve the document from the database.
   *
   * @param {string} collectionid
   * @param {string} docid
   * @param {string} clock
   * @return {Array<Uint8Array>}
   */
  getDocument (collectionid, docid, clock) {
    error.methodUnimplemented()
  }

  /**
   * @param {string} collectionid
   * @param {string} clock
   * @param {function(Array<{ clock: string, docid: string, update: Uint8Array }>):void} iterator
   * @return {Promise<void>}
   */
  iterateCollection (collectionid, clock, iterator) {
    error.methodUnimplemented()
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {Uint8Array} update
   * @param {string} clock
   * @return {Promise<void>}
   */
  storeUpdate (collectionid, docid, update, clock) {
    error.methodUnimplemented()
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @param {Uint8Array} update
   * @param {string} startClock
   * @param {string} endClock
   */
  storeMergedUpdate (collectionid, docid, update, startClock, endClock) {
    error.methodUnimplemented()
  }
}

export class AbstractClientStorage extends AbstractObjectStorage {
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
