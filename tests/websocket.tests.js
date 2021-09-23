
import '../bin/websocket-server.js'
import WS from 'ws'
import * as t from 'lib0/testing'
import { RedisWebsocketProvider } from '../src/y-redis.js'
import Redis from 'ioredis'

const redisConn = new Redis()
/**
 * @param {t.TestCase} tc
 */
const init = async tc => {
  const collectionid = tc.testName.toLowerCase()
  // @ts-ignore
  await redisConn.xtrim(collectionid, 'MAXLEN', '0')
  return { collectionid }
}

/**
 * @type {any}
 */
const WebSocketPolyfill = typeof WebSocket === 'undefined' ? WS : WebSocket // eslint-disable-line

/**
 * @param {t.TestCase} tc
 */
export const testSync = async tc => {
  const { collectionid } = await init(tc)
  const provider = new RedisWebsocketProvider('ws://localhost:4321', { WebSocketPolyfill })
  const doc = provider.getDoc(collectionid, 'main')
  doc.getArray().insert(0, ['X'])

  const provider2 = new RedisWebsocketProvider('ws://localhost:4321', { WebSocketPolyfill })
  const doc2 = provider2.getDoc(collectionid, 'main')
  return new Promise(resolve => {
    doc2.getArray().observe(() => {
      t.compareArrays(doc2.getArray().toArray(), ['X'])
      resolve(void 0)
    })
  })
}
