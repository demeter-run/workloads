import { Network } from "@demeter-sdk/framework";
import { KubernetesObject, V1ContainerStatus, V1ListMeta } from '@kubernetes/client-node';
import { IncomingMessage } from "http";

type ResourceRequest = {
  memory: string;
  cpu: string;
}


export type ResourceSpec = {
  image: string;
  replicas: number;
  enabled: boolean;
  args: string;
  envVars: Record<string, string>[];
  annotations: Record<string, string>;
  resources: {
    requests: ResourceRequest,
    limits: ResourceRequest
  }
  storage: {
    class: string,
    size: string,
  };
  tenancy: 'cluster' | 'project' | 'proxy'
};

export type ResourceStatus = {
  privateDns: string;
  runningStatus: 'paused' | 'running' | 'provisioning' | 'syncing';
  availableReplicas: number;
  observedGeneration?: number;
};

export interface CustomResource extends KubernetesObject {
  spec: ResourceSpec;
  status: ResourceStatus;
}

export interface CustomResourceList {
  /**
   * APIVersion defines the versioned schema of this representation of an object. Servers should convert recognized schemas to the latest internal value, and may reject unrecognized values. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#resources
   */
  apiVersion?: string;
  /**
   * Items is the list of stateful sets.
   */
  items: Array<CustomResource>;
  /**
   * Kind is a string value representing the REST resource this object represents. Servers may infer this from the endpoint the client submits requests to. Cannot be updated. In CamelCase. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#types-kinds
   */
  kind?: string;
  metadata?: V1ListMeta;
}


export type CustomResourceResponse = {
  response: IncomingMessage;
  body: CustomResource;
};

export type CustomResourceListResponse = {
  response: IncomingMessage;
  body: CustomResourceList;
};

export type Pod = {
  uid: string;
  name: string;
  status: string;
  startTime: string;
  containers: V1ContainerStatus[];
};