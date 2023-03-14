import { KubernetesObject, V1ContainerStatus, V1ListMeta, V1PersistentVolumeClaim } from '@kubernetes/client-node';
import { IncomingMessage } from 'http';

export * as DataWorker from './data-worker';

export type WorkloadStatus = 'paused' | 'running' | 'provisioning' | 'syncing' | 'error';

export type EnvVar = {
  name: string,
  value: string,
}
export type StorageClass = 'gp3' | 'fast';

export type StorageItem = {
  name: string,
  size: string,
  class: StorageClass,
  inUse: boolean,
}

export interface ISpec {
  givenName: string;
  image: string;
  replicas: number;
  enabled: boolean;
  args: string;
  envVars: EnvVar[];
  annotations: Record<string, string>;
  tenancy: 'cluster' | 'project' | 'proxy'
  resources: {
    requests: ResourceRequest,
    limits: ResourceRequest
  }
  [k: string]: unknown
}

export interface IStatus {
  runningStatus: WorkloadStatus;
  availableReplicas: number;
  observedGeneration: number;
  availableEnvVars: string[];
  startTime: number;
  computeDCUPerMin: number;
  [k: string]: unknown
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

