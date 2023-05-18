import { KubernetesObject, V1ContainerStatus, V1ListMeta } from '@kubernetes/client-node';
import { IncomingMessage } from 'http';

export * as BackendWithStorage from './backend-with-storage';
export * as Workspace from './workspace';
export * as Backend from './backend';
export * as Frontend from './frontend';

export type WorkloadStatus = 'paused' | 'running' | 'provisioning' | 'syncing' | 'error' | 'degraded';

export type EnvVar = {
  name: string,
  value: string,
}
export type StorageClass = 'gp2' | 'gp3' | 'fast';

export type WorkloadConfig = {
  name: string,
  config: string,
}

export type StorageItem = {
  name: string,
  size: string,
  class: StorageClass,
  inUse: boolean,
}

export type GenericWorkload = {
  givenName: string;
  enabled: boolean;
  annotations: Record<string, string>;
  computeClass: string;
}


export type MetricsStatus = {
  runningStatus: WorkloadStatus;
  availableReplicas: number;
  observedGeneration: number;
  startTime: number;
  computeDCUPerMin: number;
  storageDCUPerMin: number;
  lastError: string;
}

export type ResourceRequest = {
  memory: string;
  cpu: string;
}

export interface CustomResource<Spec, Status> extends KubernetesObject {
  spec: Spec,
  status: Status,
}

export interface CustomResourceList<Spec, Status> {
  /**
   * APIVersion defines the versioned schema of this representation of an object. Servers should convert recognized schemas to the latest internal value, and may reject unrecognized values. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#resources
   */
  apiVersion?: string;
  /**
   * Items is the list of stateful sets.
   */
  items: Array<CustomResource<Spec, Status>>;
  /**
   * Kind is a string value representing the REST resource this object represents. Servers may infer this from the endpoint the client submits requests to. Cannot be updated. In CamelCase. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#types-kinds
   */
  kind?: string;
  metadata?: V1ListMeta;
}

export type CustomResourceResponse<Spec, Status> = {
  response: IncomingMessage;
  body: CustomResource<Spec, Status>;
};

export type CustomResourceListResponse<Spec, Status> = {
  response: IncomingMessage;
  body: CustomResourceList<Spec, Status>;
};

export type Pod = {
  uid: string;
  name: string;
  status: string;
  startTime: string;
  containers: V1ContainerStatus[];
};

export interface WorkloadPvc {
  name: string;
  size: string;
  class: string;
  inUse?: boolean;
};

