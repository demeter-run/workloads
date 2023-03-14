/* eslint-disable @typescript-eslint/no-non-null-asserted-optional-chain */
import { namespaceToSlug } from '@demeter-sdk/framework';
import { ageGauge, dcuCounter, restartCount, statusGauge } from './prometheus';
import { CustomResource, ISpec, IStatus } from '@demeter-run/workloads-types';

const MAX_SCRAPE_DELTA_S = 30;
const DESIRED_INTERVAL = process.env.SCRAPE_INTERVAL_S ? Number(process.env.SCRAPE_INTERVAL_S) : MAX_SCRAPE_DELTA_S;

interface StatusResource extends CustomResource<ISpec, IStatus> {
  lastChecked: number;
  upTime: number;
}

export const STATUS: Record<string, number> = {
  running: 2,
  provisioning: 1,
  paused: 0,
  error: -1,
  syncing: 1,
};

function buildPayload<Spec, Status>(item: CustomResource<Spec, Status>) {
  return { service: `${item.kind}-${item.metadata?.name}`, project: namespaceToSlug(item.metadata?.namespace!), service_type: item.apiVersion, tenancy: 'project' };
}

function getDiffInMinutes(start: number, end: number) {
  return Math.min(start - end, 2 * DESIRED_INTERVAL) / 60;
}

function trackStatus<Spec extends ISpec, Status extends IStatus>(item: CustomResource<Spec, Status>) {
  statusGauge.set(buildPayload(item), STATUS[item.status.runningStatus]);
}

function trackComputeDCU(item: StatusResource, currentUptime: number) {
  if (cache.has(item.metadata?.name!)) {
    const cacheUptime = cache.get(item.metadata?.name!)!.upTime;
    if (cacheUptime) {
      const diff = getDiffInMinutes(currentUptime, cacheUptime);
      const increase = Math.round(diff * item.status.computeDCUPerMin);
      if (typeof increase === 'number' && increase > 0) {
        dcuCounter.inc(
          buildPayload(item),
          increase,
        );
      }
    }
  }
}

function trackStorageDCU(item: StatusResource) {
  if (cache.has(item.metadata?.name!)) {
    const lastChecked = cache.get(item.metadata?.name!)!.lastChecked;
    if (lastChecked) {
      const diff = getDiffInMinutes(item.lastChecked, lastChecked);
      const increase = Math.round(diff * Number(item.status.storageDCUPerMin));
      if (typeof increase === 'number' && increase > 0) {
        dcuCounter.inc(
          buildPayload(item),
          increase,
        );
      }
    }
  }
}

function trackRestartCount(item: StatusResource) {
  if (cache.has(item.metadata?.name!)) {
    const cachedItem = cache.get(item.metadata?.name!);
    if (cachedItem?.status.runningStatus === 'paused' || cachedItem?.status.runningStatus === 'provisioning') {
      restartCount.inc(buildPayload(item), 1);
    }
  }
}

// The trackAge function also tracks Compute DCU since it needs the uptime as well;
function trackAge(item: StatusResource): number | null {
  const startTime = item.status.startTime;
  if (!startTime) return null;
  const uptime = Math.round((Date.now() - startTime) / 1000);
  ageGauge.set(buildPayload(item), uptime);
  trackComputeDCU(item, uptime);
  return uptime;
}

const cache: Map<string, StatusResource> = new Map();

function updateCache(item: StatusResource) {
  cache.set(item.metadata?.name!, item)
}

const STORAGE_KINDS = ['DataWorker'];

export async function collectWorkloadMetrics<Spec extends ISpec, Status extends IStatus>(item: CustomResource<Spec, Status>) {
  // we need a lastChecked to compute storage DCU
  const status = item as unknown as StatusResource;
  status.lastChecked = Date.now();
  trackStatus(item);
  if (item.status.storageDCUPerMin) {
    trackStorageDCU(status);
  }
  const age = trackAge(status);
  if (age) {
    status.upTime = age;
  }
  trackRestartCount(status);

  updateCache(status);
}


