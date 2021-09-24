
import * as t from 'lib0/testing'
import { MemoryStorage } from '../src/y-redis.js'

const storageSolutions = () => [{ name: 'memory', storage: new MemoryStorage() }]

/**
 * @param {t.TestCase} tc
 */
export const testStoringUpdates = async tc => {
  storageSolutions().forEach(({ storage, name }) => {
    t.groupAsync(name, async () => {
      storage.storeUpdate('testcollection', 'testdoc', new Uint8Array([1]), '3')
      storage.storeUpdate('testcollection', 'testdoc', new Uint8Array([2]), '4')
      t.assert(storage.getDocument('testcollection', 'testdoc', '0').length === 2)
    })
  })
}
