import { collectClusterMetrics as backendWithStorageMetrics } from "../backend-with-storage/metrics";
import { collectClusterMetrics as workspaceMetrics } from "../workspaces/metrics";
import { collectClusterMetrics as backendMetrics } from "../backend/metrics";

import { executeRecurrentTask } from "../utils";
const SCRAPE_MIN_INTERVAL = 30 * 1000;
const SCRAPE_DESIRED_INTERVAL = process.env.SCRAPE_INTERVAL_S ? Number(process.env.SCRAPE_INTERVAL_S) * 1000 : SCRAPE_MIN_INTERVAL;


export default function collectMetrics() {
  executeRecurrentTask(backendWithStorageMetrics, { label: 'bws-metrics', desiredInterval: SCRAPE_DESIRED_INTERVAL, minInterval: SCRAPE_MIN_INTERVAL });
  executeRecurrentTask(workspaceMetrics, { label: 'wks-metrics', desiredInterval: SCRAPE_DESIRED_INTERVAL, minInterval: SCRAPE_MIN_INTERVAL });
  executeRecurrentTask(backendMetrics, { label: 'bnd-metrics', desiredInterval: SCRAPE_DESIRED_INTERVAL, minInterval: SCRAPE_MIN_INTERVAL });
}

