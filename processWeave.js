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

  // Patch :latest tag, because of:
  //   https://github.com/weaveworks/weave/issues/3974
  //   https://github.com/weaveworks/weave/issues/3960#issuecomment-1401496388
  //   https://github.com/weaveworks/weave/issues/3948#issuecomment-1401989143
  // No longer needed because the source has changed to rajch/weave
  // patchLatestTag(ds)

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

const processEnvVar = (varname, varvalue, ds) => {
  if (allowedEnvVars.includes(varname)) {

    //ds.spec.template.spec.containers[0].env.push({ name: varname, value: varvalue })
    upsertEnvVar(ds.spec.template.spec.containers[0].env, { name: varname, value: varvalue })
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
  } else {
    console.log(`Ignoring unknown option ${optname}`)
  }
}

// The 'version' query parameter

const processVersion = (optname, optval, ds) => {
  console.log(`Processing option ${optname}=${optval}`)

  const replaceLatest = (imageName, optval) => {
    return imageName.replace(/\:latest$/, `:${optval}`)
  }

  // Change the image property of the init container
  // if it exists
  if (ds.spec.template.spec.initContainers[0]) {
    ds.spec.template.spec.initContainers[0].image = replaceLatest(
      ds.spec.template.spec.initContainers[0].image,
      optval
    )
  }

  // Change the image property of the first, and if it 
  // exists, the second container. The second container
  // may have been deleted by another option.
  ds.spec.template.spec.containers[0].image = replaceLatest(
    ds.spec.template.spec.containers[0].image,
    optval
  )
  if (ds.spec.template.spec.containers[1]) {
    ds.spec.template.spec.containers[1].image = replaceLatest(
      ds.spec.template.spec.containers[1].image,
      optval
    )
  }
}

// The 'disable-npc' query parameter

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
  'version': processVersion,
  'disable-npc': processDisableNPC
}

const patchLatestTag = (ds) => {
  processVersion('version', '2.8.1', ds)
}

export default processWeave