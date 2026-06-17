import type { JobQueue } from "./types";

let _queue: JobQueue | null = null;

export function getQueue(): JobQueue {
  if (!_queue) {
    if (process.env.QUEUE_PROVIDER === "servicebus") {
      // Dynamic require avoids loading @azure/service-bus in local dev
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ServiceBusQueue } = require("./service-bus-queue");
      _queue = new ServiceBusQueue();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DbQueue } = require("./db-queue");
      _queue = new DbQueue();
    }
  }
  return _queue!;
}

export { namespaceDedup } from "./types";
export type { JobQueue, JobPayload, EnqueueOptions } from "./types";
