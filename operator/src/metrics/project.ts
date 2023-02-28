/* eslint-disable @typescript-eslint/no-non-null-asserted-optional-chain */
import { namespaceToSlug, Network } from '@demeter-sdk/framework';
import { ageGauge, dcuCounter, restartCount, statusGauge } from './prometheus';
import { CustomResource, Pod } from '@demeter-run/workloads-types';

// Compute DCU
const COMPUTE_PER_MIN_MAINNET_DCUS = process.env.CUSTOM_COMPUTE_PER_MIN_MAINNET_DCUS ? Number(process.env.CUSTOM_COMPUTE_PER_MIN_MAINNET_DCUS) : 12000;
const COMPUTE_PER_MIN_DEFAULT_DCUS = process.env.CUSTOM_COMPUTE_PER_MIN_DEFAULT_DCUS ? Number(process.env.CUSTOM_COMPUTE_PER_MIN_DEFAULT_DCUS) : 4000;
// Storage DCU
const STORAGE_PER_MIN_MAINNET_DCUS = process.env.CUSTOM_STORAGE_PER_MIN_MAINNET_DCUS ? Number(process.env.CUSTOM_STORAGE_PER_MIN_MAINNET_DCUS) : 21;
const STORAGE_PER_MIN_DEFAULT_DCUS = process.env.CUSTOM_STORAGE_PER_MIN_DEFAULT_DCUS ? Number(process.env.CUSTOM_STORAGE_PER_MIN_DEFAULT_DCUS) : 7;

const MAX_SCRAPE_DELTA_S = 30;
const DESIRED_INTERVAL = process.env.SCRAPE_INTERVAL_S ? Number(process.env.SCRAPE_INTERVAL_S) : MAX_SCRAPE_DELTA_S;

interface StatusResource extends CustomResource<any, any> {
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

function buildPayload(item: StatusResource) {
  return { service: `${item.kind}-${item.metadata?.name}`, project: namespaceToSlug(item.metadata?.namespace!), service_type: item.apiVersion, tenancy: 'project' };
}

function getComputeDCUS(network: Network) {
  if (network === 'mainnet') return COMPUTE_PER_MIN_MAINNET_DCUS;
  return COMPUTE_PER_MIN_DEFAULT_DCUS;
}

function getStorageDCUS(network: Network) {
  if (network === 'mainnet') return STORAGE_PER_MIN_MAINNET_DCUS;
  return STORAGE_PER_MIN_DEFAULT_DCUS;
}

function getDiffInMinutes(start: number, end: number) {
  return Math.min(start - end, 2 * DESIRED_INTERVAL) / 60;
}

function trackStatus(item: StatusResource) {
  statusGauge.set(buildPayload(item), STATUS[item.status.runningStatus]);
}

function trackComputeDCU(item: StatusResource, currentUptime: number) {
  if (cache.has(item.metadata?.name!)) {
    const cacheUptime = cache.get(item.metadata?.name!)!.upTime;
    if (cacheUptime) {
      const diff = getDiffInMinutes(currentUptime, cacheUptime);
      dcuCounter.inc(
        buildPayload(item),
        Math.round(diff * getComputeDCUS(item.spec.network as Network)),
      );
    }
  }
}

function trackStorageDCU(item: StatusResource) {
  if (cache.has(item.metadata?.name!)) {
    const lastChecked = cache.get(item.metadata?.name!)!.lastChecked;
    if (lastChecked) {
      const diff = getDiffInMinutes(item.lastChecked, lastChecked);
      dcuCounter.inc(
        buildPayload(item),
        Math.round(diff * getStorageDCUS(item.spec.network as Network)),
      );
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
async function trackAge(item: StatusResource, listResourcePods: (ns: string, name: string) => Promise<Pod[] | null>): Promise<number | null> {
  try {
    const pods = await listResourcePods(namespaceToSlug(item.metadata?.namespace!), item.metadata?.name!);
    if (!pods?.length) return null;
    const startTime = pods[0].startTime;
    if (!startTime) return null;
    const uptime = Math.round((Date.now() - new Date(startTime).valueOf()) / 1000);
    ageGauge.set(buildPayload(item), uptime);
    trackComputeDCU(item, uptime);
    return uptime;
  } catch (err) {
    console.error(err);
    return null;
  }
}

const cache: Map<string, StatusResource> = new Map();

function updateCache(item: StatusResource) {
  cache.set(item.metadata?.name!, item)
}

const STORAGE_KINDS = ['DataWorker'];

export async function collectWorkloadMetrics(item: CustomResource<any, any>, listResourcePods: (ns: string, name: string) => Promise<Pod[] | null>) {
  const status = item as StatusResource;
  // we need a lastChecked to compute storage DCU
  status.lastChecked = Date.now();
  trackStatus(status);
  if (STORAGE_KINDS.includes(item.kind!)) {
    trackStorageDCU(status);
  }

  if (item.status.runningStatus === 'running') {
    const age = await trackAge(status, listResourcePods);
    if (age) {
      status.upTime = age;
    }
    trackRestartCount(status);
  }
  updateCache(status);
}


