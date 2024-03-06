'use strict'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.txt': 'text/plain'
}
const defaultMimeType = 'application/octet-stream'
const __dirname = fileURLToPath(new URL('.', import.meta.url))

const processStatic = async (req, res, url) => {
  if (!url) {
    url = req.url
  }

  const filePath = path.join(__dirname, '..', 'public', url)
  const mimeType = getMimeType(filePath)

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('File not found')
    } else {
      res.writeHead(200, { 'Content-Type': mimeType })
      res.end(data)
    }
  })
}

const getMimeType = (filePath) => {
  const extname = path.extname(filePath)
  return mimeTypes[extname] || defaultMimeType
}

export default processStatic

