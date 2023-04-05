variable "namespace" {}

variable "image_tag" {}

variable "cluster_name" {}

variable "uptime_interval" {
  description = "the inverval for checking workspace uptime and decide if it should be turned off"
  default     = "300"
}

variable "workspace_expire" {
  description = "the value in seconds after a workspace is considered as expired."
  default     = "1800" // 30 minutes
}

variable "pause_expired_workspaces" {
  description = "Wether expired workspaces should be paused or not"
  default     = "false"
}

variable "scrape_interval" {
  description = "the inverval for polling workspaces data (in seconds)"
  default     = "30"
}
variable "per_min_dcus" {
  default = {
    "storage" : {
      "fast" : 16,
      "gp3" : 8
    }
  }
}

variable "dns_zone" {
  description = "publicly-available dns zone of the cluster"
  default     = "demeter.run"
}

resource "kubernetes_deployment_v1" "operator" {
  wait_for_rollout = false

  metadata {
    namespace = var.namespace
    name      = "operator"
    labels = {
      role = "operator"
    }
  }

  spec {
    replicas = 1

    selector {
      match_labels = {
        role = "operator"
      }
    }

    template {
      metadata {
        labels = {
          role = "operator"
        }
      }

      spec {
        container {
          image   = "ghcr.io/demeter-run/workloads-operator:${var.image_tag}"
          name    = "main"
          command = ["npm", "run", "start"]

          env {
            name  = "PORT"
            value = 9946
          }

          env {
            name  = "K8S_IN_CLUSTER"
            value = "true"
          }

          env {
            name  = "SCRAPE_INTERVAL_S"
            value = var.scrape_interval
          }

          env {
            name  = "GP3_STORAGE_PER_GB_PER_MIN_DCUS"
            value = var.per_min_dcus.storage.gp3
          }

          env {
            name  = "FAST_STORAGE_PER_GB_PER_MIN_DCUS"
            value = var.per_min_dcus.storage.fast
          }

          env {
            name  = "UPTIME_INTERVAL_S"
            value = var.uptime_interval
          }

          env {
            name  = "EXPIRE_WORKSPACE_S"
            value = var.workspace_expire
          }
          env {
            name  = "PAUSE_EXPIRED_WORKSPACES"
            value = var.pause_expired_workspaces
          }

          resources {
            limits = {
              memory = "250Mi"
            }
            requests = {
              cpu    = "50m"
              memory = "250Mi"
            }
          }

          port {
            name           = "metrics"
            container_port = 9946
            protocol       = "TCP"
          }

          volume_mount {
            mount_path = "/config"
            name       = "config"
          }
        }

        volume {
          name = "config"
          config_map {
            name = module.configs.cm_name
          }
        }
      }
    }
  }
}

