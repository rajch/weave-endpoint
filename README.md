# weave-endpoint

HTTP server to download weave net manifest 

## Raison d'etre

Since the Weave Cloud was [shut down](https://www.weave.works/blog/weave-cloud-end-of-service) in September 2022, the recommended method of installing the weave net CNI plugin became unavailable. This project is an attempt to recreate that method.

## How to use

The recommended method for installing weave used to be this:

```
kubever=$(kubectl version | base64 | tr -d '\n')
kubectl apply -f https://cloud.weave.works/k8s/net?k8s-version=$kubever
```
This would redirect to the simpler url:
```
https://cloud.weave.works/k8s/vX.YZ/net.yaml
```
which would generate a manifest appropriate to the version of kubernetes.

This project is currently hosted on a Free-tier Azure Web App, accessible at `https://weave-community-downloader.azurewebsites.net/`.

Weave can now be installed on a kubernetes cluster using:

```bash
kubever=$(kubectl version | base64 | tr -d '\n')
kubectl apply -f https://weave-community-downloader.azurewebsites.net/k8s/net?k8s-version=$kubever
```
OR

```bash
kubectl apply -f https://weave-community-downloader.azurewebsites.net/k8s/v1.25/net.yaml
```
where the `v1.25` part can be replaced with any kubernetes version down to 1.8.

## Customising the manifest

You can customise the YAML you get by passing some of Weave Net's options, arguments and environment variables as query parameters. **Note:** This is a work in progress. The parameters that have been implemented are called out below.

  - `version`: Weave Net's version. Default: `latest`, i.e. latest release. *N.B.*: This only changes the specified version inside the generated YAML file, it does not ensure that the rest of the YAML is compatible with that version. To freeze the YAML version save a copy of the YAML file from the [release page](https://github.com/weaveworks/weave/releases) and use that copy instead of downloading it each time. **Note:** This is implemented.  
  - `password-secret`: name of the Kubernetes secret containing your password.  *N.B*: The Kubernetes secret name must correspond to a name of a file containing your password.
     Example:

        $ echo "s3cr3tp4ssw0rd" > /var/lib/weave/weave-passwd
        $ kubectl create secret -n kube-system generic weave-passwd --from-file=/var/lib/weave/weave-passwd
        $ kubectl apply -f "https://cloud.weave.works/k8s/net?k8s-version=$(kubectl version | base64 | tr -d '\n')&password-secret=weave-passwd"

  - `known-peers`: comma-separated list of hosts. Default: empty.
  - `trusted-subnets`: comma-separated list of CIDRs. Default: empty.
  - `disable-npc`: boolean (`true|false`). Default: `false`. **Note:** This is implemented.
  - `env.NAME=VALUE`: add environment variable `NAME` and set it to `VALUE`. **Note:** This is implemented, for the allowed set of variables.
  - `seLinuxOptions.NAME=VALUE`: add SELinux option `NAME` and set it to `VALUE`, e.g. `seLinuxOptions.type=spc_t`. **Note:** This is implemented, but no sanity check on SELinux options.

The list of variables you can set is:

* `CHECKPOINT_DISABLE` - if set to 1, disable checking for new Weave Net
  versions (default is blank, i.e. check is enabled)
* `CONN_LIMIT` - soft limit on the number of connections between
  peers. Defaults to 200.
* `HAIRPIN_MODE` - Weave Net defaults to enabling hairpin on the bridge side of
  the `veth` pair for containers attached. If you need to disable hairpin, e.g. your
  kernel is one of those that can panic if hairpin is enabled, then you can disable it
  by setting `HAIRPIN_MODE=false`.
* `IPALLOC_RANGE` - the range of IP addresses used by Weave Net
  and the subnet they are placed in (CIDR format; default `10.32.0.0/12`)
* `EXPECT_NPC` - set to 0 to disable Network Policy Controller (default is on)
* `KUBE_PEERS` - list of addresses of peers in the Kubernetes cluster
  (default is to fetch the list from the api-server)
* `IPALLOC_INIT` - set the initialization mode of the [IP Address
  Manager](/site/operational-guide/concepts.md#ip-address-manager)
  (defaults to consensus amongst the `KUBE_PEERS`)
* `WEAVE_EXPOSE_IP` - set the IP address used as a gateway from the
  Weave network to the host network - this is useful if you are
  configuring the addon as a static pod.
* `WEAVE_METRICS_ADDR` - address and port that the Weave Net
  daemon will serve Prometheus-style metrics on (defaults to 0.0.0.0:6782)
* `WEAVE_STATUS_ADDR` - address and port that the Weave Net
  daemon will serve status requests on (defaults to disabled)
* `WEAVE_MTU` - Weave Net defaults to 1376 bytes, but you can set a
  smaller size if your underlying network has a tighter limit, or set
  a larger size for better performance if your network supports jumbo
  frames - see [here](/site/tasks/manage/fastdp.md#mtu) for more
  details.
* `NO_MASQ_LOCAL` - set to 0 to disable preserving the client source IP address when
  accessing Service annotated with `service.spec.externalTrafficPolicy=Local`.
  This feature works only with Weave IPAM (default).
* `IPTABLES_BACKEND` - set to `nft` to use `nftables` backend for `iptables` (default is `iptables`) 

Example:
```
$ kubectl apply -f "https://weave-community-downloader.azurewebsites.net/k8s/net?k8s-version=$(kubectl version | base64 | tr -d '\n')&env.WEAVE_MTU=1337"
```
This command -- notice `&env.WEAVE_MTU=1337` at the end of the URL -- generates a YAML file containing, among others:

```
[...]
          containers:
            - name: weave
[...]
              env:
                - name: WEAVE_MTU
                  value: '1337'
[...]
```

**Note**: The YAML file can also be saved for later use or manual editing by using, for example:
```
$ curl -fsSLo weave-daemonset.yaml "https://weave-community-downloader.azurewebsites.net/k8s/net?k8s-version=$(kubectl version | base64 | tr -d '\n')"
```

## How it works

~~A simple request on either url pattern, without any query parameters, will redirect to the k8s-version-appropriate manifest on the latest weave net release on GitHub.~~

~~If there are query parameters, the appropriate manifest will be fetched, modified as per the parameters, and emitted.~~

The k8s-version-appropriate manifest is fetched from the latest weave net release on GitHub.

It is then modified as per parameters, and emitted.

One compulsory modification is: the `:latest` tag on all images found in the manifest is changed to `:2.8.1`. This is because of issue [3974](https://github.com/weaveworks/weave/issues/3974) on the weave net repository, and a [solution](https://github.com/weaveworks/weave/issues/3960#issuecomment-1401496388) proposed in a comment on another issue.
