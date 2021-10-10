import * as error from 'lib0/error'

/**
 * @interface
 */
export class AbstractObjectStorage {
  /**
   * Retrieve the latest clock for a collection.
   *
   * @param {string} collectionid
   * @return {Promise<string>}
   */
  getClock (collectionid) {
    error.methodUnimplemented()
  }

  /**
   * This will serve as a subscription. this.getCollections() should return this collectionid with clock=0.
   *
   * Returns the current clock.
   *
   * @param {string} collectionid
   * @return {Promise<string>}
   */
  initializeCollection (collectionid) {
    error.methodUnimplemented()
  }

  /**
   * Update the clock of a collection. This should automatically serve as a subscription.
   *
   * @return {Promise<Array<{ collectionid: string, clock: string }>>}
   */
  getCollections () {
    error.methodUnimplemented()
  }

  /**
   * Retrieve the document from the database.
   *
   * @param {string} collectionid
   * @param {string} docid
   * @param {string} clock
   * @return {Promise<{ updates: Array<Uint8Array>, endClock: string }>}
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
   * @return {Promise<string>} Return an identifier that we can later use to delete this pending update.
   */
  storePendingUpdate (collectionid, docid, update) {
    error.methodUnimplemented()
  }

  /**
   * We move an update from pending to actual message buffer after it has been acknowledged by the server.
   *
   * @param {string} pid
   */
  confirmPendingUpdate (pid) {
    error.methodUnimplemented()
  }

  /**
   * @param {function({ collectionid: string, docid: string, update: Uint8Array }): void} f
   * @return {Promise<void>}
   */
  iteratePendingUpdates (f) {
    error.methodUnimplemented()
  }

  /**
   * @param {string} collectionid
   * @param {string} docid
   * @return {Promise<Array<Uint8Array>>}
   */
  getPendingDocumentUpdates (collectionid, docid) {
    error.methodUnimplemented()
  }
}
