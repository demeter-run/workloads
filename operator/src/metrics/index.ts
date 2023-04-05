import { collectClusterMetrics as dataWorkerMetrics } from "../data-workers/metrics";
import { collectClusterMetrics as workspaceMetrics } from "../workspaces/metrics";

import { executeRecurrentTask } from "../utils";
const SCRAPE_MIN_INTERVAL = 30 * 1000;
const SCRAPE_DESIRED_INTERVAL = process.env.SCRAPE_INTERVAL_S ? Number(process.env.SCRAPE_INTERVAL_S) * 1000 : SCRAPE_MIN_INTERVAL;


export default function collectMetrics() {
  executeRecurrentTask(dataWorkerMetrics, { label: 'dwk-metrics', desiredInterval: SCRAPE_DESIRED_INTERVAL, minInterval: SCRAPE_MIN_INTERVAL });
  executeRecurrentTask(workspaceMetrics, { label: 'wks-metrics', desiredInterval: SCRAPE_DESIRED_INTERVAL, minInterval: SCRAPE_MIN_INTERVAL });
}

