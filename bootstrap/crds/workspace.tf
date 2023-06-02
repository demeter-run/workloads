resource "kubernetes_manifest" "workspaces" {
  manifest = {
    "apiVersion" = "apiextensions.k8s.io/v1"
    "kind"       = "CustomResourceDefinition"
    "metadata" = {
      "name" = "workspaces.demeter.run"
    }
    "spec" = {
      "group" = "demeter.run"
      "names" = {
        "kind"   = "Workspace"
        "plural" = "workspaces"
        "shortNames" = [
          "wks",
        ]
        "singular" = "workspace"
      }
      "scope" = "Namespaced"
      "versions" = [
        {
          "additionalPrinterColumns" = [
            {
              "jsonPath" = ".spec.enabled"
              "name"     = "Enabled"
              "type"     = "boolean"
            },
            {
              "jsonPath" = ".status.runningStatus"
              "name"     = "Status"
              "type"     = "string"
            },
            {
              "jsonPath" = ".spec.computeClass"
              "name"     = "Compute Class"
              "type"     = "string"
            },
            {
              "jsonPath" = ".spec.storage.class"
              "name"     = "Storage Class"
              "type"     = "string"
            },
            {
              "jsonPath" = ".spec.storage.size"
              "name"     = "Storage Size"
              "type"     = "string"
            },
            {
              "jsonPath" = ".status.computeDCUPerMin"
              "name"     = "Compute DCU/min"
              "type"     = "number"
            },
            {
              "jsonPath" = ".status.storageDCUPerMin"
              "name"     = "Storage DCU/min"
              "type"     = "number"
            },
          ]
          "name" = "v1alpha1"
          "schema" = {
            "openAPIV3Schema" = {
              "properties" = {
                "spec" = {
                  "properties" = {
                    "annotations" = {
                      "type"                                 = "object"
                      "x-kubernetes-preserve-unknown-fields" = true
                    }
                    "computeClass" = {
                      "type" = "string"
                    }
                    "enabled" = {
                      "type" = "boolean"
                    }
                    "pinned" = {
                      "type" = "boolean"
                    }
                    "extras" = {
                      "items" = {
                        "type" = "string"
                      }
                      "type" = "array"
                    }
                    "givenName" = {
                      "type" = "string"
                    }
                    "ide" = {
                      "properties" = {
                        "authToken" = {
                          "type" = "string"
                        }
                        "image" = {
                          "type" = "string"
                        }
                        "type" = {
                          "type" = "string"
                        }
                      }
                      "type" = "object"
                    }
                    "sourceCode" = {
                      "properties" = {
                        "authorEmail" = {
                          "type" = "string"
                        }
                        "authorName" = {
                          "type" = "string"
                        }
                        "branch" = {
                          "type" = "string"
                        }
                        "url" = {
                          "type" = "string"
                        }
                      }
                      "type" = "object"
                    }
                    "storage" = {
                      "properties" = {
                        "class" = {
                          "type" = "string"
                        }
                        "size" = {
                          "pattern" = "^(\\d+(e\\d+)?|\\d+(\\.\\d+)?(e\\d+)?[EPTGMK]i?)$"
                          "type"    = "string"
                        }
                      }
                      "type" = "object"
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
                    "healthUrl" = {
                      "type" = "string"
                    }
                    "lastSeen" = {
                      "type" = "number"
                    }
                    "lastUpdated" = {
                      "type" = "number"
                    }
                    "observedGeneration" = {
                      "type" = "number"
                    }
                    "openUrl" = {
                      "type" = "string"
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
