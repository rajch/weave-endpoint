'use strict'

import { IncomingMessage, ServerResponse, createServer } from 'node:http'
import processWeave from './src/processWeave.js'
import processStatic from './src/proccessStatic.js'
import { WEAVE_VERSION } from './src/parseWeave.js'

const SERVER_PORT = process.env.PORT || 8080

const requestListener = async (/** @type {IncomingMessage} */ req, /** @type {ServerResponse} */ res) => {
  console.log('----------------------------')
  console.log(`Request: ${req.url}`)

  if (req.url === '/') {
    await processStatic(req, res, '/index.html')
  } else if (req.url.startsWith('/k8s/')) {
    await processWeave(req, res)
  } else {
    await processStatic(req, res)
  }
}

console.log(`Server starting on port: ${SERVER_PORT}\nWeave version:${WEAVE_VERSION}\n`)
const server = createServer(requestListener)
const signalHandler = (signal) => {
  console.log(`Received signal ${signal}.`)
  console.log('Shutting down...')
  server.close(() => {
    console.log('Server shut down.')
    process.exit(0)
  })
}
server.listen(SERVER_PORT)
process.on('SIGINT', signalHandler)
process.on('SIGTERM', signalHandler)
