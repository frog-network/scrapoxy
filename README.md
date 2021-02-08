# Scrapoxy

![Scrapoxy](docs/logo.png)

http://scrapoxy.io

This repo is a fork from the original [repo](https://github.com/fabienvauchelles/scrapoxy) 

## Documentation for GCP provider  by [Ahmed R.](https://github.com/ahmedrshdy)

To add a GCP provider, you must first add a forward proxy custom image to your GCP project, you can follow same instructions stated in documnetation for [digital ocean](https://scrapoxy.readthedocs.io/en/master/standard/providers/digitalocean/create_image/index.html) but make sure you are creating a storage image not a machine image.

I am using Debian 10 on E2-micromachine but you can use whatever you want for the forward proxy as long as you are sure it is working for you.

Afterwards, simply create a provider in your conf.json using the following provider template:
```
"providers": [
        {
            "type": "gcp",
            "region": "[region and zone]",
            "tag": "scrapoxy",
            "instance": {
                "machineType": "e2-micro ",
                "disks": [
                    {
                        "boot": true,
                        "type": "PERSISTENT",
                        "initializeParams": {
                            "sourceImage": "projects/[project]/global/images/[forward proxy image name]"
                        }
                    }
                ],
                "networkInterfaces": [
                    {
                        "network": "projects/[project]/global/networks/[your network]",
                        "subnetwork": "regions/[region]/subnetworks/[your subnetwork]",
                        "accessConfigs": [{
                            "networkTier": "PREMIUM",
                            "type": "ONE_TO_ONE_NAT"
                        }]
                    }
                ],
                "tags": [
                    "scrapoxy"
                ]
            }
        }
    ]
```
### Notes
* If you are going to use the default network then remove subnetwork property and use `global/networks/default` for netwrok or ommit it all networkInterfaces
* Region property should only have the region with zone e.g. europe-west2
* Region property for subnetwork (if used) should match the region and zone property but without zone e.g europe-west2


## Change log:

* Feb 8,2021    feature: add GCP provider using PR submittted by [Abinash Panda](https://github.com/abprime) with improvements to accept custom networks and subnetworks

* Feb 2, 2021   fix: prevent process crash on invalid headers being sent, by [Antoine R.](https://github.com/antoinerabany)

