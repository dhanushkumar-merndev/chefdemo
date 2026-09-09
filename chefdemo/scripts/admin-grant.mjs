import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const email = process.argv
  .slice(2)
  .find((x) => x !== "--")
  ?.trim()
  .toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: pnpm admin:grant you@example.com");
  process.exit(1);
}
const literal = "'" + email.replaceAll("'", "''") + "'";
const directory = await mkdtemp(join(tmpdir(), "chefflow-admin-"));
try {
  const file = join(directory, "grant.sql");
  await writeFile(
    file,
    `begin;
    update public.profiles set role = 'admin', approval_status = 'approved' where email = ${literal};
    insert into public.staff_access(email,name,role)
      select ${literal}, 'Administrator', 'admin'
      where not exists(select 1 from public.profiles where email = ${literal})
      on conflict(email) do update set role = 'admin';
    commit;`,
    { mode: 0o600 },
  );
  const result = spawnSync(
    "npx",
    ["--yes", "supabase", "db", "query", "--linked", "--file", file],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else
    console.log(
      "Administrator access is ready. Register or sign in with the authorized email.",
    );
} finally {
  await rm(directory, { recursive: true, force: true });
}
