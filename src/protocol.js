import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { RedisWebsocketProvider } from './websocket-client.js' // eslint-disable-line
import * as Y from 'yjs' // eslint-disable-line
import { Client, RedisConn } from './redis-helpers.js' // eslint-disable-line
import { ClientConn } from '../bin/websocket-server.js' // eslint-disable-line
import { logger } from './helpers.js'
import * as promise from 'lib0/promise'

export const MESSAGE_UPDATE_SERVER = 0
export const MESSAGE_UPDATE_CLIENT = 1
export const MESSAGE_SUBSCRIBE_COLLECTION = 2
export const MESSAGE_CONFIRM = 3

/**
 * @param {string} collectionid
 * @param {Array<{docid: string, update: Uint8Array, pendingid: string}>} docUpdates
 * @return {Uint8Array} Encoded message that you can propagate
 */
export const encodeDocumentUpdates = (collectionid, docUpdates) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_UPDATE_CLIENT)
  encoding.writeVarString(encoder, collectionid)
  encoding.writeVarUint(encoder, docUpdates.length)
  docUpdates.forEach(({ docid, update, pendingid }) => {
    encoding.writeVarString(encoder, pendingid)
    encoding.writeVarString(encoder, docid)
    encoding.writeVarUint8Array(encoder, update)
  })
  return encoding.toUint8Array(encoder)
}

/**
 * @param {Array<string>} pendingids
 * @return {Uint8Array}
 */
export const encodeConfirmingMessage = pendingids => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_CONFIRM)
  encoding.writeVarUint(encoder, pendingids.length)
  pendingids.forEach(pendingid => {
    encoding.writeVarString(encoder, pendingid)
  })
  return encoding.toUint8Array(encoder)
}

/**
 * @param {encoding.Encoder} encoder
 * @param {Map<string, { clock: string }>} collections
 */
export const clientRequestSubscriptions = (encoder, collections) => {
  encoding.writeVarUint(encoder, MESSAGE_SUBSCRIBE_COLLECTION)
  encoding.writeVarUint(encoder, collections.size)
  collections.forEach(({ clock }, collectionid) => {
    encoding.writeVarString(encoder, collectionid)
    encoding.writeVarString(encoder, clock)
  })
}

/**
 * @param {encoding.Encoder} encoder
 * @param {string} collectionid
 * @param {string} docid
 * @param {Uint8Array} update
 * @param {string} clock
 */
export const serverWriteUpdate = (encoder, collectionid, docid, update, clock) => {
  encoding.writeUint8(encoder, MESSAGE_UPDATE_SERVER)
  encoding.writeVarString(encoder, collectionid)
  encoding.writeVarString(encoder, docid)
  encoding.writeVarUint8Array(encoder, update)
  encoding.writeVarString(encoder, clock)
}

/**
 * @param {decoding.Decoder} decoder
 * @param {RedisWebsocketProvider} provider
 * @return {Promise<any>}
 */
export const clientReadMessage = (decoder, provider) => {
  const promises = []
  while (decoding.hasContent(decoder)) {
    switch (decoding.readVarUint(decoder)) {
      case MESSAGE_UPDATE_SERVER: {
        const collectionid = decoding.readVarString(decoder)
        const docid = decoding.readVarString(decoder)
        const update = decoding.readVarUint8Array(decoder)
        const clock = decoding.readVarString(decoder)
        const collection = provider.collections.get(collectionid)
        promises.push(provider.storage.storeUpdate(collectionid, docid, update, clock))
        logger('Received update from server', { docid, clock })
        if (collection) {
          const ydoc = collection.ydocs.get(docid)
          collection.clock = clock
          if (ydoc) {
            Y.applyUpdateV2(ydoc, update, provider)
          }
        }
        break
      }
      case MESSAGE_CONFIRM: {
        let len = decoding.readVarUint(decoder)
        while (len--) {
          const pendingid = decoding.readVarString(decoder)
          provider.storage.confirmPendingUpdate(pendingid)
        }
        break
      }
    }
  }
  return promise.all(promises)
}

/**
 * @param {Uint8Array} message
 * @param {RedisConn} redisConn
 * @param {ClientConn} clientConn
 */
export const serverReadMessage = (message, redisConn, clientConn) => {
  const decoder = decoding.createDecoder(new Uint8Array(message))
  /**
   * @type {Array<Promise<string>>}
   */
  const confirmingPromises = []
  while (decoding.hasContent(decoder)) {
    switch (decoding.readUint8(decoder)) {
      case MESSAGE_UPDATE_CLIENT: {
        const collectionid = decoding.readVarString(decoder)
        const docUpdates = decoding.readVarUint(decoder)
        for (let i = 0; i < docUpdates; i++) {
          const pendingid = decoding.readVarString(decoder)
          const docid = decoding.readVarString(decoder)
          const update = decoding.readVarUint8Array(decoder)
          logger('Received update from client', { docid, collectionid, pendingid })
          confirmingPromises.push(redisConn.publish(collectionid, docid, update).then(() => pendingid))
        }
        break
      }
      case MESSAGE_SUBSCRIBE_COLLECTION: {
        let size = decoding.readVarUint(decoder)
        while (size--) {
          const collectionid = decoding.readVarString(decoder)
          const clock = decoding.readVarString(decoder)
          logger('Received subscription event from client', { collectionid, clock })
          clientConn.subscribe(collectionid, clock)
        }
        break
      }
    }
  }
  if (confirmingPromises.length > 0) {
    promise.all(confirmingPromises).then(pending => {
      clientConn.ws.send(encodeConfirmingMessage(pending))
    })
  }
}
