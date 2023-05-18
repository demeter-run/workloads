resource "kubernetes_manifest" "backends" {
  manifest = {
    "apiVersion" = "apiextensions.k8s.io/v1"
    "kind" = "CustomResourceDefinition"
    "metadata" = {
      "name" = "backends.demeter.run"
    }
    "spec" = {
      "group" = "demeter.run"
      "names" = {
        "kind" = "Backend"
        "plural" = "backends"
        "shortNames" = [
          "bnd",
        ]
        "singular" = "backend"
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
                    "command" = {
                      "type" = "string"
                    }
                    "config" = {
                      "items" = {
                        "properties" = {
                          "config" = {
                            "type" = "string"
                          }
                          "name" = {
                            "type" = "string"
                          }
                        }
                        "type" = "object"
                      }
                      "type" = "array"
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