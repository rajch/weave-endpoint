'use strict'

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import parseWeaveUrl from './parseWeave.js'
import processWeave from './processWeave.js'

const SERVER_PORT = process.env.PORT || 8080

/**
 * 
 * @param {IncomingMessage} req 
 * @param {ServerResponse} res 
 * @returns 
 */
const requestListener = async (req, res) => {
  console.log('----------------------------')
  console.log(`Request: ${req.url}`)
  
  let urlResult = parseWeaveUrl(req.url)
  if (!urlResult.matched) {
    res.writeHead(404, 'No manifest found')
    res.end()
    return
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host}`)
  
  // If there are any query string parameters other than 'k8s-version',
  // process them
  const params = reqUrl.searchParams
  params.delete('k8s-version')

  // This weird syntax for checking the number of url parameters is
  // due to the lack of a 'size' member. See 
  // https://github.com/whatwg/url/issues/163
  if (!params.entries().next().done) {
    console.log(`Processing request with ${params}...`)
  
    const result = await processWeave(urlResult.manifestUrl, params)
    if(result.status=='success'){
      res.setHeader('Content-type','application/yaml')
      res.writeHead(200,'Ok')
      res.write(result.body)
    } else {
      res.setHeader('Content-type','application/json')
      res.writeHead(500,'Error while processing')
      res.write(JSON.stringify(result,"\t"))
    }
    res.end()
    return
  }

  console.log(`Redirecting request with ${params}...`)
  res.writeHead(302, {
    location: urlResult.manifestUrl
  })
  res.end()
}

const server = createServer(requestListener);
server.listen(SERVER_PORT);