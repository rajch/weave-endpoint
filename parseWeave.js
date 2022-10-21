'use strict'

const WEAVE_VERSION = '2.8.1'
const weaveManifestUrl = (fileName) => {
  return `https://github.com/weaveworks/weave/releases/download/v${WEAVE_VERSION}/${fileName}`
}

const manifestMap = [
  { k8sVersion: '12', result: weaveManifestUrl('weave-daemonset-k8s.yaml') },
  { k8sVersion: '11', result: weaveManifestUrl('weave-daemonset-k8s-1.11.yaml') },
  { k8sVersion: '9', result: weaveManifestUrl('weave-daemonset-k8s-1.9.yaml') },
  { k8sVersion: '8', result: weaveManifestUrl('weave-daemonset-k8s-1.8.yaml') }
]

/**
 * Gets Weave Net Manifest
 * @param {Object} kubeVersion The kubernetes version
 * @param {string} kubeVersion.major K8s Major version
 * @param {string} kubeVersion.minor K8s Minor version
 * 
 */
const getWeaveManifest = (kubeVersion) => {
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
  const base64Decode = Buffer.from(str, "base64")
  return base64Decode.toString()
}

/**
 * Decodes a base64-encoded kubernetes version string.
 * @param {string} versionString The encoded string
 */
const decodeVersion = (versionString) => {
  const decoded = base64Decode(versionString)
  // This matches the output of `kubectl version` in k8s versions up to v1.25
  const pattern1 = /GitVersion:"v(\d{1})\.(\d{1,2})\.(.*)"/
  // This matches the output of `kubectl version --short`, which is going to 
  // become the default output of `kubectl version` in the near future
  const pattern2 = /Client Version: v(\d{1})\.(\d{1,2})\.(.*)/

  let matched = decoded.match(pattern1)
  if (matched) {
    return getWeaveManifest({
      major: matched[1],
      minor: matched[2]
    })
  }

  matched = decoded.match(pattern2)
  if (matched) {
    return getWeaveManifest({
      major: matched[1],
      minor: matched[2]
    })
  }

  return {
    matched: false
  }
}

/**
 * Parses a url to see if it matches one of the two weave patterns.
 * @param {string} url A URL path with an optional querystring
 */
const parseWeaveUrl = (url) => {
  // This matches <host>/k8s/v{MAJOR}.{MINOR}/net.yaml
  const pattern1 = /^\/(k8s\/)?v(\d{1}).(\d{1,2})\/net.yaml/i
  // This matches <host>/k8s/net?k8s-version={BASE64-encoded `kubectl version` output}
  const pattern2 = /^\/(k8s\/)?(net\?k8s-version=){1}(.*)/i

  let matched = url.match(pattern1)
  if (matched) {
    return getWeaveManifest({
      major: matched[2],
      minor: matched[3]
    })
  }

  matched = url.match(pattern2)
  if (matched) {
    return decodeVersion(matched[3])
  }

  return {
    matched: false
  }
}

export default parseWeaveUrl