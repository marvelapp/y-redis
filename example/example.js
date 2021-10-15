/* eslint-env browser */
import { RedisWebsocketProvider } from '../client/y-redis-client.js'

// enable logging of all internal messages - this is a feature of lib0/logging
localStorage.setItem('log', 'true')

const provider = new RedisWebsocketProvider('ws://localhost:4321')
provider.subscribeCollection('test')
provider.on('synced', /** @param {Array<string>} collections */ collections => {
  console.log('Synced the following collections: ', collections)
})

// @ts-ignore
window.provider = provider
