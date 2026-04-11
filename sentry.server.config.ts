import * as Sentry from "@sentry/bun";

Sentry.init({
  dsn: "https://3f3dae05e3afbc641ad49ef76bb00864@o4511202186428416.ingest.us.sentry.io/4511202226470912",
  enableLogs: true,
  tracesSampleRate: 1.0,
  sendDefaultPii: true,
  environment: "production",
});
