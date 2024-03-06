'use strict'

import { URL } from 'node:url'
import fetch from 'node-fetch'
import yaml from 'js-yaml'
import parseWeaveUrl from './parseWeave.js'

const cacheMap = {}

const processWeave = async (req, res) => {
  const urlResult = parseWeaveUrl(req.url)
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

  console.log(`Processing request with ${params}...`)

  const result = await processWeaveManifest(urlResult.manifestUrl, params)
  if (result.status === 'success') {
    res.setHeader('Content-type', 'application/yaml')
    res.writeHead(200, 'Ok')
    res.write(result.body)
  } else {
    res.setHeader('Content-type', 'application/json')
    res.writeHead(500, 'Error while processing')
    res.write(JSON.stringify(result, '\t'))
  }
  res.end()
}

/**
 * Generates a weave manifest from Github release source and url parameters
 * @param {string} weaveManifestUrl
 * @param {URLSearchParams} params
 */
const processWeaveManifest = async (weaveManifestUrl, params) => {
  const manifest = cacheMap[weaveManifestUrl]
  if (manifest) {
    console.log(`getting ${weaveManifestUrl} from cache`)
    return process(manifest, params)
  }

  console.log(`getting ${weaveManifestUrl} from remote`)
  const manifestDownload = await fetch(weaveManifestUrl)
  const data = await manifestDownload.text()
  if (manifestDownload.status === 200) {
    cacheMap[weaveManifestUrl] = data
  }

  return process(data, params)
}

/**
 * Processes the weave net yaml manifest downloaded from
 * the latest release.
 * @param {string} manifest
 * @param {URLSearchParams} params
 */
const process = (manifest, params) => {
  let yamlDocs

  try {
    yamlDocs = yaml.loadAll(manifest)
  } catch {
    return processError('Could not read yaml from manifest')
  }

  // The weave net manifest contains a List object, which
  // should have an items array.
  const items = yamlDocs[0] ? yamlDocs[0].items : undefined
  if (!items) {
    return processError('List not found')
  }

  // There should be a DaemonSet object in the items array
  const ds = items.find((doc) => doc.kind === 'DaemonSet')
  if (!ds) {
    return processError('Could not find daemonset')
  }

  for (const opt of params.entries()) {
    // Process env.NAME=VALUE options
    const envParamMatch = opt[0].match(/env\.(.*)/)
    if (envParamMatch) {
      processEnvVar(envParamMatch[1], opt[1], ds)
      continue
    }

    // Process seLinuxOptions.NAME=VALUE options
    const seLinuxParamMatch = opt[0].match(/seLinuxOptions\.(.*)/)
    if (seLinuxParamMatch) {
      processSELinuxOption(seLinuxParamMatch[1], opt[1], ds)
      continue
    }

    // Process other options
    processOtherOptions(opt[0], opt[1], ds)
  }

  return {
    status: 'success',
    body: yaml.dump(yamlDocs[0])
  }
}

/**
 * Inserts or modifies an environment variable in an env: array
 * @param {Object[]} envvararray
 * @param {Object} element
 * @param {string} element.name
 * @param {string} element.value
 */
const upsertEnvVar = (envvararray, element) => {
  const existingIndex = envvararray.findIndex((v) => v.name === element.name)
  if (existingIndex !== -1) {
    console.log(`Modifying env var ${element.name}=${element.value} at index ${existingIndex}`)
    envvararray[existingIndex].value = element.value
  } else {
    console.log(`Adding env var ${element.name}=${element.value}`)
    envvararray.push(element)
  }
}

const processError = (message) => {
  console.log(message)
  return { status: 'error', body: message }
}

// Environment Variable query parameters

const allowedEnvVars = [
  'CHECKPOINT_DISABLE',
  'CONN_LIMIT',
  'HAIRPIN_MODE',
  'IPALLOC_RANGE',
  'EXPECT_NPC',
  'IPALLOC_INIT',
  'WEAVE_EXPOSE_IP',
  'WEAVE_METRICS_ADDR',
  'WEAVE_STATUS_ADDR',
  'WEAVE_MTU',
  'NO_MASQ_LOCAL',
  'IPTABLES_BACKEND'
]

/**
 * Manipulates environment variables in the first container defined in the
 * Weave Net manifest.
 * @param {string} varname
 * @param {string} varvalue
 * @param {any} ds
 */
const processEnvVar = (varname, varvalue, ds) => {
  if (allowedEnvVars.includes(varname)) {
    // ds.spec.template.spec.containers[0].env.push({ name: varname, value: varvalue })
    upsertEnvVar(ds.spec.template.spec.containers[0].env, { name: varname, value: varvalue })
  } else {
    console.log(`Not adding unknown env var ${varname}=${varvalue}`)
  }
}

// SELinux query parameters

/**
 * Manipulates SELinux settings in the pod spec defined in the
 * Weave Net manifest.
 * @param {string} optname
 * @param {string} optvalue
 * @param {any} ds
 */
const processSELinuxOption = (optname, optval, ds) => {
  console.log(`Adding SELinux option ${optname}=${optval}`)
  ds.spec.template.spec.securityContext.seLinuxOptions[optname] = optval
}

// All other query parameters

/**
 * Handles any other url parameters.
 * @param {string} optname
 * @param {string} optvalue
 * @param {any} ds
 */
const processOtherOptions = (optname, optval, ds) => {
  const processor = otherOptionsMap[optname]
  if (processor) {
    processor(optname, optval, ds)
  } else {
    console.log(`Ignoring unknown option ${optname}`)
  }
}

/**
 * Handles the 'version' query parameter by setting the image versions of
 * all containers in the pod spec defined in the Weave Net manifest.
 * @param {string} optname
 * @param {string} optvalue
 * @param {any} ds
 */
const processVersion = (optname, optval, ds) => {
  console.log(`Processing option ${optname}=${optval}`)

  const replaceImageTag = (imageName, optval) => {
    return imageName.replace(/:(.*)$/, `:${optval}`)
  }

  // Change the image property of the init container
  // if it exists
  if (ds.spec.template.spec.initContainers[0]) {
    ds.spec.template.spec.initContainers[0].image = replaceImageTag(
      ds.spec.template.spec.initContainers[0].image,
      optval
    )
  }

  // Change the image property of the first, and if it
  // exists, the second container. The second container
  // may have been deleted by another option.
  ds.spec.template.spec.containers[0].image = replaceImageTag(
    ds.spec.template.spec.containers[0].image,
    optval
  )
  if (ds.spec.template.spec.containers[1]) {
    ds.spec.template.spec.containers[1].image = replaceImageTag(
      ds.spec.template.spec.containers[1].image,
      optval
    )
  }
}

/**
 * Handles the 'disable-npc' query parameter by setting an environment
 * variable, and deleteing the second container in the pod spec defined
 * in the Weave Net manifest.
 * @param {string} optname
 * @param {string} optvalue
 * @param {any} ds
 */
const processDisableNPC = (optname, optval, ds) => {
  console.log(`Processing option ${optname}=${optval}`)

  if (optval !== 'true') {
    return
  }

  // Set the EXPECT_NPC environment variable to '0'
  processEnvVar('EXPECT_NPC', '0', ds)

  // Remove the weave-npc container if it exists
  const npcContainerIndex = ds.spec.template.spec.containers.findIndex((c) => c.name === 'weave-npc')
  if (npcContainerIndex !== -1) {
    ds.spec.template.spec.containers.splice(npcContainerIndex, 1)
  }
}

const otherOptionsMap = {
  version: processVersion,
  'disable-npc': processDisableNPC
}

export default processWeave
