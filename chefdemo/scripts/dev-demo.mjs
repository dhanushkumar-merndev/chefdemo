import { spawn } from "node:child_process";
const child = spawn(
  "pnpm",
  ["exec", "next", "dev", "--hostname", "0.0.0.0", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_TEST_DIST: ".next-demo",
    },
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
