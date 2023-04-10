resource "kubernetes_manifest" "backendswithstorage" {
  manifest = {
    "apiVersion" = "apiextensions.k8s.io/v1"
    "kind" = "CustomResourceDefinition"
    "metadata" = {
      "name" = "backendswithstorage.demeter.run"
    }
    "spec" = {
      "group" = "demeter.run"
      "names" = {
        "kind" = "BackendWithStorage"
        "plural" = "backendswithstorage"
        "shortNames" = [
          "bws",
        ]
        "singular" = "backendwithstorage"
      }
      "scope" = "Namespaced"
      "versions" = [
        {
          "additionalPrinterColumns" = [
            {
              "jsonPath" = ".spec.enabled"
              "name" = "Enabled"
              "type" = "boolean"
            },
            {
              "jsonPath" = ".spec.replicas"
              "name" = "Replicas"
              "type" = "number"
            },
            {
              "jsonPath" = ".spec.computeClass"
              "name" = "Compute Class"
              "type" = "string"
            },
            {
              "jsonPath" = ".spec.storage.class"
              "name" = "Storage Class"
              "type" = "string"
            },
            {
              "jsonPath" = ".spec.storage.size"
              "name" = "Storage Size"
              "type" = "string"
            },
            {
              "jsonPath" = ".status.computeDCUPerMin"
              "name" = "Compute DCU/min"
              "type" = "number"
            },
            {
              "jsonPath" = ".status.storageDCUPerMin"
              "name" = "Storage DCU/min"
              "type" = "number"
            },
          ]
          "name" = "v1alpha1"
          "schema" = {
            "openAPIV3Schema" = {
              "properties" = {
                "spec" = {
                  "properties" = {
                    "annotations" = {
                      "type" = "object"
                      "x-kubernetes-preserve-unknown-fields" = true
                    }
                    "args" = {
                      "type" = "string"
                    }
                    "computeClass" = {
                      "type" = "string"
                    }
                    "enabled" = {
                      "type" = "boolean"
                    }
                    "envVars" = {
                      "items" = {
                        "properties" = {
                          "name" = {
                            "type" = "string"
                          }
                          "value" = {
                            "type" = "string"
                          }
                        }
                        "type" = "object"
                      }
                      "type" = "array"
                    }
                    "givenName" = {
                      "type" = "string"
                    }
                    "image" = {
                      "type" = "string"
                    }
                    "replicas" = {
                      "type" = "number"
                    }
                    "storage" = {
                      "properties" = {
                        "class" = {
                          "type" = "string"
                        }
                        "size" = {
                          "pattern" = "^(\\d+(e\\d+)?|\\d+(\\.\\d+)?(e\\d+)?[EPTGMK]i?)$"
                          "type" = "string"
                        }
                      }
                      "type" = "object"
                    }
                    "tenancy" = {
                      "pattern" = "^(\\b(cluster|project|proxy)\\b)$"
                      "type" = "string"
                    }
                  }
                  "type" = "object"
                }
                "status" = {
                  "properties" = {
                    "availableEnvVars" = {
                      "items" = {
                        "type" = "string"
                      }
                      "type" = "array"
                    }
                    "availableReplicas" = {
                      "type" = "number"
                    }
                    "computeDCUPerMin" = {
                      "type" = "number"
                    }
                    "observedGeneration" = {
                      "type" = "number"
                    }
                    "runningStatus" = {
                      "type" = "string"
                    }
                    "startTime" = {
                      "type" = "number"
                    }
                    "storage" = {
                      "items" = {
                        "properties" = {
                          "class" = {
                            "type" = "string"
                          }
                          "inUse" = {
                            "type" = "boolean"
                          }
                          "name" = {
                            "type" = "string"
                          }
                          "size" = {
                            "type" = "string"
                          }
                        }
                        "type" = "object"
                      }
                      "type" = "array"
                    }
                    "storageDCUPerMin" = {
                      "type" = "number"
                    }
                  }
                  "type" = "object"
                }
              }
              "type" = "object"
            }
          }
          "served" = true
          "storage" = true
          "subresources" = {
            "status" = {}
          }
        },
      ]
    }
  }
}