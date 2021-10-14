
import '../server/websocket-server.js'
import WS from 'ws'
import * as t from 'lib0/testing'
import { RedisWebsocketProvider } from '../client/y-redis-client.js'
import Redis from 'ioredis'
import * as promise from 'lib0/promise'

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
export const testSyncc = async tc => {
  const { collectionid } = await init(tc)
  const provider = new RedisWebsocketProvider('ws://localhost:4321', { WebSocketPolyfill })
  const doc = provider.getDoc(collectionid, 'main')
  doc.getArray().insert(0, ['X'])
  await promise.wait(500)

  const provider2 = new RedisWebsocketProvider('ws://localhost:4321', { WebSocketPolyfill })
  const whenSynced = promise.create(resolve => {
    provider2.on('synced', resolve)
  })
  const doc2 = provider2.getDoc(collectionid, 'main')
  console.log('before whenSynced')
  await whenSynced
  console.log('after whenSynced')
  t.compareArrays(doc2.getArray().toArray(), ['X'])

  console.log('before insert')
  doc2.getArray().insert(1, ['Y'])

  console.log('waiting..')
  await promise.create(resolve => {
    doc.getArray().observe(() => {
      t.compareArrays(doc.getArray().toArray(), ['X', 'Y'])
      resolve(void 0)
    })
  })
  console.log('done')
}
