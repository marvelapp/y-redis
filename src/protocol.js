import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { RedisWebsocketProvider } from './websocket-client.js' // eslint-disable-line
import * as Y from 'yjs' // eslint-disable-line
import { Client, RedisConn } from './redis-helpers.js' // eslint-disable-line
import { ClientConn } from '../bin/websocket-server.js' // eslint-disable-line
import { logger } from './helpers.js'

export const MESSAGE_UPDATE_SERVER = 0
export const MESSAGE_UPDATE_CLIENT = 1
export const MESSAGE_SUBSCRIBE_COLLECTION = 2

/**
 * @param {string} collectionid
 * @param {Array<{docid: string, update: Uint8Array}>} docUpdates
 * @return {Uint8Array} Encoded message that you can propagate
 */
export const encodeDocumentUpdates = (collectionid, docUpdates) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_UPDATE_CLIENT)
  encoding.writeVarString(encoder, collectionid)
  encoding.writeVarUint(encoder, docUpdates.length)
  docUpdates.forEach(({ docid, update }) => {
    encoding.writeVarString(encoder, docid)
    encoding.writeVarUint8Array(encoder, update)
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
 */
export const clientReadMessage = (decoder, provider) => {
  while (decoding.hasContent(decoder)) {
    switch (decoding.readVarUint(decoder)) {
      case MESSAGE_UPDATE_SERVER: {
        const collectionid = decoding.readVarString(decoder)
        const docid = decoding.readVarString(decoder)
        const update = decoding.readVarUint8Array(decoder)
        const clock = decoding.readVarString(decoder)
        const collection = provider.collections.get(collectionid)
        logger('Received update from server', { docid, clock })
        if (collection) {
          const ydoc = collection.ydocs.get(docid)
          collection.clock = clock
          if (ydoc) {
            Y.applyUpdateV2(ydoc, update)
          }
        }
      }
    }
  }
}

/**
 * @param {Uint8Array} message
 * @param {RedisConn} redisConn
 * @param {ClientConn} clientConn
 */
export const serverReadMessage = (message, redisConn, clientConn) => {
  const decoder = decoding.createDecoder(new Uint8Array(message))
  while (decoding.hasContent(decoder)) {
    switch (decoding.readUint8(decoder)) {
      case MESSAGE_UPDATE_CLIENT: {
        const collectionid = decoding.readVarString(decoder)
        const docUpdates = decoding.readVarUint(decoder)
        for (let i = 0; i < docUpdates; i++) {
          const docid = decoding.readVarString(decoder)
          const update = decoding.readVarUint8Array(decoder)
          logger('Received update from client', { docid, collectionid })
          redisConn.publish(collectionid, docid, update)
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
}
