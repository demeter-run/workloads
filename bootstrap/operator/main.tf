variable "namespace" {}

variable "image_tag" {}

variable "cluster_name" {}

variable "idle_interval" {
  description = "the inverval for checking workspace uptime and decide if it should be turned off"
  default     = "300"
}

variable "workspace_idle" {
  description = "the value in seconds after a workspace is considered as idle."
  default     = "1800" // 30 minutes
}

variable "pause_idle_workspaces" {
  description = "Wether expired workspaces should be paused or not"
  default     = "true"
}

variable "workspace_expire" {
  description = "the value in days after a workspace is considered as expired (i.e: should be deleted)"
  default     = "14" // 14 days
}

variable "delete_expired_workspaces" {
  description = "Wether expired workspaces should be deleted or not"
  default     = "false"
}

variable "expire_interval" {
  description = "the inverval for checking workspace expiration"
  default     = "7200" // 2 hours
}

variable "scrape_interval" {
  description = "the inverval for polling workspaces data (in seconds)"
  default     = "30"
}

variable "config_map_name" {
  description = "the name of the config map holding values for compute, extras, etc"
  default     = "workloads"
}

variable "per_min_dcus" {
  default = {
    "storage" : {
      "fast" : 2,
      "gp3" : 1
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
            name  = "IDLE_INTERVAL_S"
            value = var.idle_interval
          }

          env {
            name  = "IDLE_WORKSPACE_S"
            value = var.workspace_idle
          }
          env {
            name  = "PAUSE_IDLE_WORKSPACES"
            value = var.pause_idle_workspaces
          }

          env {
            name  = "EXPIRE_INTERVAL_S"
            value = var.expire_interval
          }

          env {
            name  = "EXPIRE_WORKSPACE_DAYS"
            value = var.workspace_expire
          }

          env {
            name  = "DELETE_EXPIRED_WORKSPACES"
            value = var.delete_expired_workspaces
          }

          env {
            name = "CLUSTER_NAME"
            value = var.cluster_name
          }

          env {
            name = "DNS_ZONE"
            value = var.dns_zone
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
            mount_path = "/app/config"
            name       = "config"
          }
        }

        volume {
          name = "config"
          config_map {
            name = var.config_map_name
          }
        }
      }
    }
  }
}

