This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Scheduled jobs (external cron)

Several background tasks run off HTTP endpoints that an external scheduler must
call on a cron — they do not self-trigger. Each is gated by the `x-worker-secret`
request header, which must match the `WORKER_SECRET` environment variable. (When
`WORKER_SECRET` is unset the gate is open, so set it in every deployed
environment.)

| Endpoint | Method | Recommended cadence | Purpose |
| --- | --- | --- | --- |
| `/api/jobs/process` | `POST` | As often as possible — at least every minute (`* * * * *`) | Drains the database job queue: candidate scoring, transactional emails, chat invitations/nudges/expiry, and stuck-candidate recovery. This is the throughput driver. Only needed when running the built-in DB queue (i.e. `QUEUE_PROVIDER` is not `servicebus`). |
| `/api/jobs/pending-rejection-reminders` | `POST` | Daily, e.g. 08:00 (`0 8 * * *`) | Emails recruiters/admins about candidates sitting in `pending_rejection` awaiting a human accept/dismiss decision — first after 3 days, then weekly per candidate. |
| `/api/jobs/billing-close` | `POST` | Monthly, 02:00 on the 1st (`0 2 1 * *`) | Closes the just-ended month's usage per active org, then runs the overdue-invoice and spend-alert sweeps and the POPIA expired-data purge. Accepts `?period=YYYY-MM` to re-close a past month (idempotent). |

Call each endpoint with the shared secret:

```bash
curl -X POST https://<your-host>/api/jobs/process \
  -H "x-worker-secret: $WORKER_SECRET"
```

All three are idempotent and safe to call more often than recommended; a missed
run is recovered on the next tick.

For local development, `npm run jobs:poll` hits `/api/jobs/process` every 10
seconds against `http://localhost:3000`, so queued work drains without a cron.
(On Vercel, these can alternatively be wired as `crons` in `vercel.ts`.)

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
