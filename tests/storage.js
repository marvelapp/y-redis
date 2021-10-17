
import * as promise from 'lib0/promise'
import * as t from 'lib0/testing'
import { MemoryStorage } from '../lib/storage-memory.js'

const storageSolutions = () => [{ name: 'memory', storage: new MemoryStorage() }]

/**
 * @param {t.TestCase} tc
 */
export const testStoringUpdates = async tc => {
  await promise.all(storageSolutions().map(async ({ storage, name }) => {
    await t.groupAsync(name, async () => {
      // starting tests for a specific storage solution:

      await t.groupAsync('storing updates', async () => {
        const clock = await storage.getClock(tc.testName + '#')
        t.assert(clock === '0')
        await storage.storeUpdate(tc.testName, 'testdoc', new Uint8Array([1]), '3')
        await storage.storeUpdate(tc.testName, 'testdoc', new Uint8Array([2]), '4')
        const updates = await storage.getDocument(tc.testName, 'testdoc', '0')
        const endClock = await storage.getClock(tc.testName)
        t.assert(updates.updates.length === 2)
        t.assert(updates.endClock === '4')
        t.assert(endClock === '4')
        const collections = await storage.getCollections()
        t.compare(collections, [{ collectionid: tc.testName, clock: '4' }])
      })

      await t.groupAsync('merging stored updates', async () => {
        await storage.storeMergedUpdate(tc.testName, 'testdoc', new Uint8Array([3]), '0', '4')
        const updates = await storage.getDocument(tc.testName, 'testdoc', '0')
        t.assert(updates.updates.length === 1)
        t.assert(updates.endClock === '4')
      })

      /**
       * @type {any}
       */
      let pid
      await t.groupAsync('store pending update', async () => {
        pid = await storage.storePendingUpdate(tc.testName, 'testdoc', new Uint8Array([3]))
        const pupdates = await storage.getPendingDocumentUpdates(tc.testName, 'testdoc')
        t.assert(pupdates.length === 1)
      })

      await t.groupAsync('iterate pending update', async () => {
        let calls = 0
        await storage.iteratePendingUpdates(arg => {
          calls++
        })
        t.assert(calls === 1)
      })

      await t.groupAsync('confirming pending update', async () => {
        await storage.confirmPendingUpdate(pid)
        const pupdates2 = await storage.getPendingDocumentUpdates(tc.testName, 'testdoc')
        t.assert(pupdates2.length === 0)
      })

      await t.groupAsync('calculating current clock', async () => {
        const clock = await storage.getClock(tc.testName)
        t.assert(clock === '4')
      })
    })
  }))
}
