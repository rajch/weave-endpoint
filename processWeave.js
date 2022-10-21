'use strict'

import fetch from "node-fetch"
import yaml from 'js-yaml'

const cacheMap = {}

/**
 * Generates a weave manifest from Github release and url parameters
 * @param {string} weaveManifestUrl 
 * @param {URLSearchParams} params
 */
const processWeave = async (weaveManifestUrl, params) => {
  let manifest = cacheMap[weaveManifestUrl]
  if (manifest) {
    console.log(`getting ${weaveManifestUrl} from cache`)
    return process(manifest, params)
  }

  console.log(`getting ${weaveManifestUrl} from remote`)
  const manifestDownload = await fetch(weaveManifestUrl)
  const data = await manifestDownload.text()
  cacheMap[weaveManifestUrl] = data

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

  for (let opt of params.entries()) {
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
    body: yaml.dump(yamlDocs)
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

const processEnvVar = (varname, varvalue, ds) => {
  if (allowedEnvVars.includes(varname)) {
    console.log(`Adding env var ${varname}=${varvalue}`)
    ds.spec.template.spec.containers[0].env.push({ name: varname, value: varvalue })
  } else {
    console.log(`Not adding unknown env var ${varname}=${varvalue}`)
  }
}

// SELinux query parameters

const processSELinuxOption = (optname, optval, ds) => {
  console.log(`Adding SELinux option ${optname}=${optval}`)
  ds.spec.template.spec.securityContext.seLinuxOptions[optname] = optval
}

// All other query parameters

const processOtherOptions = (optname, optval, ds) => {
  const processor = otherOptionsMap[optname]
  if (processor) {
    processor(optname, optval, ds)
  }
}

// The 'version' query parameter

const processVersion = (optname, optval, ds) => {
  console.log(`Processing option ${optname}=${optval}`)
  // Fetch the image name from the first container, and 
  // replace ':latest' with specified version.
  let imageName = ds.spec.template.spec.containers[0].image
  imageName = imageName.replace(/\:latest$/, `:${optval}`)

  // Change the image property of the first, and if it 
  // exists, the second container. The second container
  // may have been deleted by another option.
  ds.spec.template.spec.containers[0].image = imageName
  if (ds.spec.template.spec.containers[1]) {
    ds.spec.template.spec.containers[1].image = imageName
  }
}

const otherOptionsMap = {
  'version': processVersion
}

export default processWeave