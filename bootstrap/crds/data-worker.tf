resource "kubernetes_manifest" "kupo_crd" {
  manifest = {
    "apiVersion" = "apiextensions.k8s.io/v1"
    "kind"       = "CustomResourceDefinition"
    "metadata" = {
      "name" = "kupos.demeter.run"
    }
    "spec" = {
      "group" = "demeter.run"
      "names" = {
        "kind"   = "Kupo"
        "plural" = "kupos"
        "shortNames" = [
          "kp",
        ]
        "singular" = "kupo"
      }
      "scope" = "Namespaced"
      "versions" = [
        {
          "name" = "v1alpha1"
          "schema" = {
            "openAPIV3Schema" = {
              "properties" = {
                "spec" = {
                  "properties" = {
                    "deferDbIndexes" = {
                      "type" = "boolean"
                    }
                    "instanceName": {
                      "type": "string"
                    }
                    "salt": {
                      "type": "string"
                    }
                    "enabled" = {
                      "type" = "boolean"
                    }
                    "matches" = {
                      "items" = {
                        "type" = "string"
                      }
                      "type" = "array"
                    }
                    "network" = {
                      "type" = "string"
                    }
                    "pruneUtxo" = {
                      "type" = "boolean"
                    }
                    "since" = {
                      "type" = "string"
                    }
                    "replicas" = {
                      "type" = "number"
                    }
                    "tenancy" = {
                      "type" = "string" // VALIDATE 'cluster', 'project', 'proxy'
                      "pattern" = "^(\\b(cluster|project|proxy)\\b)$"
                    }
                    "resources" = {
                      "type" = "object"
                      "properties" = {
                        "limits" = {
                          "type" = "object"
                          "properties" = {
                            "cpu" : {
                              "type" : "string"
                              "pattern" : "^(\\d+m|\\d+(\\.\\d{1,3})?)$"
                            }
                            "memory" : {
                              "type" : "string"
                              "pattern" : "^(\\d+(e\\d+)?|\\d+(\\.\\d+)?(e\\d+)?[EPTGMK]i?)$"
                            }
                          }
                        }
                        "requests" = {
                          "type" = "object"
                          "properties" = {
                            "cpu" : {
                              "type" : "string"
                              "pattern" : "^(\\d+m|\\d+(\\.\\d{1,3})?)$"
                            }
                            "memory" : {
                              "type" : "string"
                              "pattern" : "^(\\d+(e\\d+)?|\\d+(\\.\\d+)?(e\\d+)?[EPTGMK]i?)$"
                            }
                          }
                        }
                      }
                    }
                    "storage" = {
                      "type" = "object"
                      "properties" = {
                        "class": {
                          "type": "string"
                        }
                        "size": {
                          "type": "string"
                          "pattern": "^(\\d+(e\\d+)?|\\d+(\\.\\d+)?(e\\d+)?[EPTGMK]i?)$"
                        }
                      }
                    }
                    "image" = {
                      "type" = "string"
                    }
                    "nodePrivateDns" = {
                      "type" = "string"
                    }
                    "labels" = {
                      "type" = "object"
                    }
                  }
                  "type" = "object"
                }
                "status" = {
                  "properties" = {
                    "observedGeneration" = {
                      "type" = "integer"
                    }
                    "privateDns" = {
                      "type" = "string"
                    }
                    "runningStatus" = {
                      "type" = "string"
                    }
                    "availableReplicas" = {
                      "type" = "number"
                    }
                    "syncStatus" = {
                      "type" = "string"
                    }
                  }
                  "type" = "object"
                }
              }
              "type" = "object"
            }
          }
          "additionalPrinterColumns" = [
            { 
              "name": "Network"
              "type": "string"
              "jsonPath": ".spec.network"
            },
            { 
              "name": "Enabled"
              "type": "boolean"
              "jsonPath": ".spec.enabled"
            },
            { 
              "name": "Defer DB Indexes"
              "type": "string"
              "jsonPath": ".spec.deferDbIndexes"
            },
            { 
              "name": "Prune UTXO"
              "type": "string"
              "jsonPath": ".spec.pruneUtxo"
            },
            { 
              "name": "Status"
              "type": "string"
              "jsonPath": ".status.runningStatus"
            },
            { 
              "name": "Sync Status"
              "type": "string"
              "jsonPath": ".status.syncStatus"
            }
          ]
          "served"  = true
          "storage" = true
          "subresources" = {
            "status" = {}
          }
        },
      ]
    }
  }
}
