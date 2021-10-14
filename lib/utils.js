import * as logging from 'lib0/logging'

/**
 * Retrieve a document from the persistent Object Storage & Redis.
 *
 * First we retrieve the redis content. Then the Object Storage. There is a slight chance that content is written from one place to another while we are performing this request.
 *
 * @param {string} collectionid
 * @param {string} docid
 */
export const retrieveDoc = (collectionid, docid) => {

}

export const logger = logging.createModuleLogger('y-redis')

/**
 * @param {string} time
 * @return {[number, number]}
 */
export const parseTimestamp = time => {
  const t = time.split('-').map(s => Number.parseInt(s))
  if (t.length === 1) {
    t.push(0)
  }
  return /** @type {any} */ (t)
}

/**
 * @param {string} time1
 * @param {string} time2
 * @return {boolean} True iff time1 >= time2
 */
export const compareTimestamps = (time1, time2) => {
  const t1 = parseTimestamp(time1)
  const t2 = parseTimestamp(time2)
  return t1[0] > t2[0] || (t1[0] === t2[0] && t1[1] >= t2[1])
}
