import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dir, "..");

async function tsc(config: string, outDir: string) {
  // Resolved, not looked up on PATH, so a test or a CI step without node_modules/.bin on PATH still builds.
  const bin = Bun.resolveSync("typescript/bin/tsc", packageDir);
  const proc = Bun.spawn([process.execPath, bin, "-p", config, "--outDir", outDir], {
    cwd: packageDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`tsc exited with ${code} for ${config}`);
}

// tsc writes the ESM, the CommonJS and the .d.ts of each, so the declarations always match the emitted code.
// The cjs folder gets its own package.json because the package itself is "type": "module".
export async function buildSdk(outDir: string = join(packageDir, "dist")): Promise<string> {
  await rm(outDir, { recursive: true, force: true });
  await tsc("tsconfig.build.json", join(outDir, "esm"));
  await tsc("tsconfig.build.cjs.json", join(outDir, "cjs"));
  await mkdir(join(outDir, "cjs"), { recursive: true });
  await writeFile(join(outDir, "cjs", "package.json"), `${JSON.stringify({ type: "commonjs" })}\n`);
  return outDir;
}

if (import.meta.main) {
  const target = process.argv[2];
  console.log(`Built @gemicore/sdk into ${await buildSdk(target ? resolve(target) : undefined)}`);
}
