import {
  ServiceBusClient,
  type ServiceBusSender,
} from "@azure/service-bus";
import { namespaceDedup, type JobQueue, type JobPayload, type EnqueueOptions } from "./types";

let client: ServiceBusClient | null = null;
const senders = new Map<string, ServiceBusSender>();

function getClient(): ServiceBusClient {
  if (!client) {
    const connectionString = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING;
    if (!connectionString)
      throw new Error("AZURE_SERVICE_BUS_CONNECTION_STRING is not set");
    client = new ServiceBusClient(connectionString);
  }
  return client;
}

function getSender(queueName: string): ServiceBusSender {
  if (!senders.has(queueName)) {
    senders.set(queueName, getClient().createSender(queueName));
  }
  return senders.get(queueName)!;
}

const QUEUE_MAP: Record<string, string> = {
  "candidate-processing": "candidate-processing",
  "send-email": "candidate-emails",
  "send-chat-invitation": "chat-invitations",
  "rescore-after-chat": "rescore-after-chat",
};

export class ServiceBusQueue implements JobQueue {
  async enqueue(payload: JobPayload, options?: EnqueueOptions): Promise<void> {
    const queueName = QUEUE_MAP[payload.type] ?? payload.type;
    const sender = getSender(queueName);
    await sender.sendMessages({
      body: payload,
      // Same org-namespacing as DbQueue → Service Bus messageId dedup is
      // tenant-safe too (two orgs' identical raw keys no longer collide).
      messageId: namespaceDedup(options?.orgId, options?.deduplicationId),
      scheduledEnqueueTimeUtc: options?.deliverAt ?? undefined,
      // Stamp the org for downstream attribution on the Service Bus path.
      ...(options?.orgId
        ? { applicationProperties: { orgId: options.orgId } }
        : {}),
    });
  }
}
