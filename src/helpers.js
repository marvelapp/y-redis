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
