'use strict'

import { URL } from 'node:url'
import fetch from 'node-fetch'
import yaml from 'js-yaml'
import { url } from 'node:inspector'
import { match } from 'node:assert'

const cacheMap = {}

export const WEAVE_VERSION = process.env.WEAVE_VERSION || '2.8.8'

const weaveReleaseUrl = (version, fileName) => {
  return `https://github.com/rajch/weave/releases/download/v${version}/${fileName}`
}

const weaveSourceUrl = (fileName) => {
  return weaveReleaseUrl(WEAVE_VERSION, fileName)
}

const manifestMap = [
  // { k8sVersion: '12', result: weaveManifestUrl('weave-daemonset-k8s.yaml') },
  { k8sVersion: '11', result: weaveSourceUrl('weave-daemonset-k8s-1.11.yaml') },
  { k8sVersion: '9', result: weaveSourceUrl('weave-daemonset-k8s-1.9.yaml') },
  { k8sVersion: '8', result: weaveSourceUrl('weave-daemonset-k8s-1.8.yaml') }
]

/**
 * @typedef {Object} manifestMatchStatus
 * @property {boolean} matched - true if an appropriate source manifest was found, else false
 * @property {string} manifestUrl - the source manifest url if found, else undefined
 */

/**
 * Chooses the version of the Weave Net manifest to download, based on Kubernetes
 * version.
 * @param {Object} kubeVersion The kubernetes version
 * @param {string} kubeVersion.major K8s Major version
 * @param {string} kubeVersion.minor K8s Minor version
 *
 * @returns {manifestMatchStatus} Manifest match status and url
 */
const chooseWeaveManifest = (kubeVersion) => {
  if (kubeVersion.major !== '1') {
    return { matched: false }
  }
  const record = manifestMap.find(
    (mm) => parseInt(kubeVersion.minor) >= parseInt(mm.k8sVersion)
  )
  if (record) {
    return { matched: true, manifestUrl: record.result }
  } else {
    return { matched: false }
  }
}

const base64Decode = (str) => {
  const base64Decode = Buffer.from(str, 'base64')
  return base64Decode.toString()
}

/**
 * Decodes a base64-encoded kubernetes version string.
 * @param {string} versionString The encoded string
 *
 * @returns {manifestMatchStatus} Manifest match status and url
 */
const decodeK8sVersionParam = (versionString) => {
  // In the classic Weave Net one-liner install, the 'k8s-version' query
  // string parameter contains the base64-encode output of the `
  // kubectl version` command. We need to decode this.

  const decoded = base64Decode(versionString)
  // This matches the output of `kubectl version` in k8s versions up to v1.25
  const pattern1 = /GitVersion:"v(\d{1})\.(\d{1,2})\.(.*)"/
  // This matches the output of `kubectl version --short`, which is going to
  // become the default output of `kubectl version` in the near future
  const pattern2 = /Client Version: v(\d{1})\.(\d{1,2})\.(.*)/

  let matched = decoded.match(pattern1)
  if (matched) {
    return chooseWeaveManifest({
      major: matched[1],
      minor: matched[2]
    })
  }

  matched = decoded.match(pattern2)
  if (matched) {
    return chooseWeaveManifest({
      major: matched[1],
      minor: matched[2]
    })
  }

  return {
    matched: false
  }
}

/**
 * Parses a url to see if it matches one of the two patterns
 * used in the Weave Net one-liner install.
 * If it does, chooses the appropriate source manifest URL.
 * @param {string} url A URL path with an optional querystring
 *
 * @returns {manifestMatchStatus} Manifest match status and url
 */
const parseWeaveUrl = (url) => {
  // This matches <host>/k8s/v{MAJOR}.{MINOR}/net.yaml
  const pattern1 = /^\/(k8s\/)?v(\d{1}).(\d{1,2})\/net.yaml/i
  // This matches <host>/k8s/net?k8s-version={BASE64-encoded `kubectl version` output}
  const pattern2 = /^\/(k8s\/)?(net\?k8s-version=){1}(.*)/i

  let matched = url.match(pattern1)
  if (matched) {
    return chooseWeaveManifest({
      major: matched[2],
      minor: matched[3]
    })
  }

  matched = url.match(pattern2)
  if (matched) {
    return decodeK8sVersionParam(matched[3])
  }

  return {
    matched: false
  }
}

export const processWeaveScript = async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const params = reqUrl.searchParams;
  const urlversionparam = params.get('version');
  const versionpattern = /v{0,1}(2\.[0-9]{1,3}\.[0-9]{1,3})/i;
  const matches = urlversionparam && urlversionparam.match(versionpattern);
  const version = matches ? matches[1] : WEAVE_VERSION;

  const scriptUrl = weaveReleaseUrl(version, 'weave')
  console.log(`Redirecting to ${scriptUrl}`)
  res.writeHead(302, { Location: scriptUrl })
  res.end()
}

export const processWeave = async (req, res) => {
  // Try to get a source manifest URL from the request URL
  const urlResult = parseWeaveUrl(req.url)
  if (!urlResult.matched) {
    res.writeHead(404, 'No manifest found')
    res.end()
    return
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host}`)

  const params = reqUrl.searchParams
  // The 'k8s-version' query parameter has already been processed
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
 * @typedef {Object} processStatus
 * @property {string} status Result of processing. 'success' or 'error'
 * @property {any} body The yaml manifest or json error produced by processing
 */

/**
 * Fetches/caches a weave manifest from Github release source or cache,
 * and processes any url parameters.
 * @param {string} weaveManifestUrl
 * @param {URLSearchParams} params
 *
 * @returns {processStatus} success with yaml body or error with json body
 */
const processWeaveManifest = async (weaveManifestUrl, params) => {
  const manifest = cacheMap[weaveManifestUrl]
  if (manifest) {
    console.log(`getting ${weaveManifestUrl} from cache`)
    return processManifest(manifest, params)
  }

  console.log(`getting ${weaveManifestUrl} from remote`)
  const manifestDownload = await fetch(weaveManifestUrl)
  const data = await manifestDownload.text()
  if (manifestDownload.status === 200) {
    cacheMap[weaveManifestUrl] = data
  }

  return processManifest(data, params)
}

/**
 * Processes the weave net yaml manifest downloaded from
 * the latest release.
 * @param {string} manifest
 * @param {URLSearchParams} params
 *
 * @returns {processStatus} success with yaml body or error with json body
 */
const processManifest = (manifest, params) => {
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

const showElement = (element) => {
  if (element.valueFrom) {
    console.log(`  valueFrom: ${JSON.stringify(element.valueFrom, '  ')}`)
  }
  if (element.value) {
    console.log(`  value: ${element.value}`)
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
    console.log(`Modifying env var ${element.name} at index ${existingIndex}`)
    showElement(element)

    if (element.valueFrom) {
      delete envvararray[existingIndex].value
      envvararray[existingIndex].valueFrom = element.valueFrom
    }
    if (element.value) {
      delete envvararray[existingIndex].valueFrom
      envvararray[existingIndex].value = element.value
    }
  } else {
    console.log(`Adding env var ${element.name}`)
    showElement(element)
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
  'WEAVE_PASSWORD',
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

/**
 * Handles the 'password-secret' query parameter by setting an environment
 * variable called WEAVE_PASSWORD, and getting its value from a Secret
 * resource whose name is the value of the parameter, and which also has a
 * key whose name is the value of the parameter.
 * @param {string} optname
 * @param {string} optvalue
 * @param {any} ds
 */
const processPasswordSecret = (optname, optval, ds) => {
  if (!optval) {
    return
  }

  upsertEnvVar(
    ds.spec.template.spec.containers[0].env,
    {
      name: 'WEAVE_PASSWORD',
      valueFrom: {
        secretKeyRef: {
          key: optval,
          name: optval
        }
      }
    }
  )
}

const otherOptionsMap = {
  version: processVersion,
  'disable-npc': processDisableNPC,
  'password-secret': processPasswordSecret
}
