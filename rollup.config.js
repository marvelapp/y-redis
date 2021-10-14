
import resolve from '@rollup/plugin-node-resolve'

const paths = path => {
  if (/^y-redis$/.test(path)) {
    return `./src/y-redis.js`
  }
  return path
}

export default [{
  input: './tests/index.js',
  output: {
    file: './dist/test.cjs',
    format: 'cjs',
    sourcemap: true
  },
  external: id => /^(lib0|yjs|ioredis)/.test(id)
}, {
  input: './example/example.js',
  output: {
    file: './example/dist/example.js',
    format: 'iife',
    sourcemap: true,
    paths
  },
  plugins: [
    resolve({ mainFields: ['browser', 'main'] })
  ]
}]
