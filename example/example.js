/* eslint-env browser */
import { RedisWebsocketProvider } from '../client/y-redis-client.js'

// enable logging of all internal messages - this is a feature of lib0/logging
localStorage.setItem('log', 'true')

const provider = new RedisWebsocketProvider('ws://localhost:4321')
provider.subscribeCollection('test')

// @ts-ignore
window.provider = provider
