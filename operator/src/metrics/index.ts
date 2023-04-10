import { collectClusterMetrics as backendWithStorageMetrics } from "../backend-with-storage/metrics";
import { collectClusterMetrics as workspaceMetrics } from "../workspaces/metrics";
import { collectClusterMetrics as backendMetrics } from "../backend/metrics";
import { collectClusterMetrics as frontendMetrics } from "../frontend/metrics";

import { executeRecurrentTask } from "../utils";
const SCRAPE_MIN_INTERVAL = 30 * 1000;
const SCRAPE_DESIRED_INTERVAL = process.env.SCRAPE_INTERVAL_S ? Number(process.env.SCRAPE_INTERVAL_S) * 1000 : SCRAPE_MIN_INTERVAL;


function randomInteger(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const MIN = 1;
const MAX = 10;

// randomize the startime so the metrics are not all collected at the same time
export default function collectMetrics() {
  setTimeout(() => executeRecurrentTask(backendWithStorageMetrics, { label: 'bws-metrics', desiredInterval: SCRAPE_DESIRED_INTERVAL, minInterval: SCRAPE_MIN_INTERVAL }), randomInteger(MIN, MAX) * 1000);
  setTimeout(() => executeRecurrentTask(workspaceMetrics, { label: 'wks-metrics', desiredInterval: SCRAPE_DESIRED_INTERVAL, minInterval: SCRAPE_MIN_INTERVAL }), randomInteger(MIN, MAX) * 1000);
  setTimeout(() => executeRecurrentTask(backendMetrics, { label: 'bnd-metrics', desiredInterval: SCRAPE_DESIRED_INTERVAL, minInterval: SCRAPE_MIN_INTERVAL }), randomInteger(MIN, MAX) * 1000);
  setTimeout(() => executeRecurrentTask(frontendMetrics, { label: 'fnd-metrics', desiredInterval: SCRAPE_DESIRED_INTERVAL, minInterval: SCRAPE_MIN_INTERVAL }), randomInteger(MIN, MAX) * 1000);
}

