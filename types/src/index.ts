import { KubernetesObject, V1ContainerStatus, V1ListMeta } from '@kubernetes/client-node';
import { IncomingMessage } from 'http';

export * as DataWorker from './data-worker';

export interface ISpec {
  [k: string]: unknown
}

export interface IStatus {
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