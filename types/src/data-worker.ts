import { ISpec, IStatus, StorageClass, StorageItem } from ".";

export interface Spec extends ISpec {
  storage: {
    class: StorageClass,
    size: string,
  };
};

export interface Status extends IStatus {
  storage: StorageItem[]
  storageDCUPerMin: number;
};