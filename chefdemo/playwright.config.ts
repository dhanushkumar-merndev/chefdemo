import { defineConfig } from "@playwright/test";

// Two apps, one per project:
//   demo — browser-persisted prototype (no Supabase).
//   sms  — live mode with Supabase and the SMS routes stubbed in the browser
//          (tests/e2e/sms-ui.spec.ts); sends no SMS, writes nothing.
const server = (port: number, env: Record<string, string>) => ({
  command: `pnpm exec next dev --hostname 127.0.0.1 --port ${port}`,
  url: `http://127.0.0.1:${port}`,
  reuseExistingServer: false,
  timeout: 120_000,
  env,
});

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  workers: 1,
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { slowMo: Number(process.env.SLOWMO ?? 0) },
  },
  projects: [
    { name: "demo", testMatch: "workflow.spec.ts", use: { baseURL: "http://127.0.0.1:3100" } },
    { name: "sms", testMatch: "sms-ui.spec.ts", use: { baseURL: "http://127.0.0.1:3101" } },
  ],
  webServer: [
    server(3100, {
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_SMS_LOGIN: "",
      NEXT_TEST_DIST: ".next-test",
    }),
    server(3101, {
      // Nothing listens here: the spec answers every Supabase call itself.
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54399",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      NEXT_PUBLIC_SMS_LOGIN: "on",
      SUPABASE_SECRET_KEY: "",
      MSG91_WIDGET_ID: "",
      MSG91_TOKEN_AUTH: "",
      MSG91_AUTH_KEY: "",
      NEXT_TEST_DIST: ".next-sms",
    }),
  ],
});
