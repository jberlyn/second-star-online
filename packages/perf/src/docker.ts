import { writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

export const DEFAULT_PERF_IMAGE = "second-star-online:local";

/** Rejects `--docker`/`--image` for modes that do not run a containerized game server. */
export function assertDockerSupported(what: string, docker?: boolean, image?: string): void {
  if ((docker || image) && (what === "browser" || what === "soak")) {
    throw new Error(`--docker/--image is not supported with "${what}"`);
  }
}

export interface DockerImageInfo {
  image: string;
  imageId: string;
  bunVersion: string;
  dockerVersion: string;
}

/** Rejects any path outside the ignored `perf-results/` directory so staging never touches live data. */
export function assertScratchDataDir(dir: string, perfResultsRoot: string): string {
  const absRoot = resolve(perfResultsRoot);
  const absDir = resolve(dir);
  const rel = relative(absRoot, absDir);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Docker perf staging directory must be inside ${absRoot}, got ${absDir}`);
  }
  return absDir;
}

function runSync(cmd: string[]): string {
  const proc = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    const err = proc.stderr.toString().trim() || proc.stdout.toString().trim();
    throw new Error(`${cmd.join(" ")} failed (${proc.exitCode}): ${err}`);
  }
  return proc.stdout.toString().trim();
}

export function inspectDockerInfo(image: string): DockerImageInfo {
  const imageId = runSync(["docker", "image", "inspect", "-f", "{{.Id}}", image]);
  const dockerVersion = runSync(["docker", "version", "--format", "{{.Server.Version}}"]);
  const bunVersion = runSync(["docker", "run", "--rm", "--entrypoint", "bun", image, "--version"]);
  return { image, imageId, bunVersion, dockerVersion };
}

export function dockerHostLine(
  info: DockerImageInfo,
  serverCore: string,
  botCores: string,
): string {
  const c = cpus();
  const shortId = info.imageId.replace(/^sha256:/, "").slice(0, 12);
  const botPin = Bun.which("taskset")
    ? `bots and relay on host cores ${botCores}`
    : "taskset missing: bots and relay unpinned";
  return (
    `Host: ${c[0]?.model ?? "unknown"}, ${c.length} cores. ` +
    `Image: ${info.image} (${shortId}), Bun ${info.bunVersion}, Docker ${info.dockerVersion}, ` +
    `server --cpuset-cpus ${serverCore}, ${botPin}.`
  );
}

/** Sets `/data` ownership to uid/gid 1000 (`bun`) via a disposable helper container. */
export function prepareDataOwnership(dataDir: string, image: string): void {
  runSync([
    "docker",
    "run",
    "--rm",
    "-u",
    "0:0",
    "-v",
    `${dataDir}:/data`,
    "--entrypoint",
    "chown",
    image,
    "-R",
    "1000:1000",
    "/data",
  ]);
}

export interface StartedContainer {
  name: string;
  stopAndRemove(logDir: string): void;
}

export function startDockerServer(options: {
  image: string;
  dataDir: string;
  port: number;
  cpusetCpus: string;
  perfOutName: string;
}): StartedContainer {
  const name = `sso-perf-${process.pid}-${Date.now()}`;
  const args = [
    "docker",
    "run",
    "-d",
    "--name",
    name,
    "-p",
    `127.0.0.1:${options.port}:3000`,
    "-v",
    `${options.dataDir}:/data`,
    "-e",
    "SSO_DB=/data/sso.sqlite",
    "-e",
    `SSO_PERF_OUT=/data/${options.perfOutName}`,
    // Every bot connects from this machine.
    "-e",
    "SSO_SOCKETS_PER_IP=0",
  ];
  if (options.cpusetCpus) {
    args.push("--cpuset-cpus", options.cpusetCpus);
  }
  args.push(options.image);
  runSync(args);

  let cleaned = false;
  return {
    name,
    stopAndRemove(logDir: string) {
      if (cleaned) {
        return;
      }
      cleaned = true;
      try {
        Bun.spawnSync(["docker", "stop", "-t", "30", name], { stdout: "pipe", stderr: "pipe" });
      } finally {
        const logs = Bun.spawnSync(["docker", "logs", name], { stdout: "pipe", stderr: "pipe" });
        try {
          writeFileSync(`${logDir}/server.log`, logs.stdout);
          writeFileSync(`${logDir}/server.err.log`, logs.stderr);
        } catch {
          // Best-effort log capture during signal cleanup.
        }
        Bun.spawnSync(["docker", "rm", "-f", name], { stdout: "pipe", stderr: "pipe" });
      }
    },
  };
}
