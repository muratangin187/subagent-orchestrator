import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
const device = z
  .object({
    id,
    name: z.string().min(1).max(80),
    cwd: z.string().startsWith("/"),
    sshHost: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/)
      .optional(),
    command: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();
const config = z
  .object({
    localId: id,
    defaultId: id,
    coordinatorSshHost: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/)
      .optional(),
    devices: z.array(device).min(1),
  })
  .strict();
export type Device = z.infer<typeof device>;
export class Devices {
  readonly config: z.infer<typeof config>;
  constructor(home: string, cwd: string) {
    const file = join(home, "devices.json");
    this.config = existsSync(file)
      ? config.parse(JSON.parse(readFileSync(file, "utf8")))
      : {
          localId: "local",
          defaultId: "local",
          devices: [{ id: "local", name: "Bu bilgisayar", cwd }],
        };
    if (
      new Set(this.config.devices.map((d) => d.id)).size !==
      this.config.devices.length
    )
      throw Error("Duplicate device id");
    this.get(this.config.localId);
    this.get(this.config.defaultId);
    for (const d of this.config.devices)
      if (
        d.id !== this.config.localId &&
        (!d.sshHost || !d.command || !this.config.coordinatorSshHost)
      )
        throw Error("Remote devices need SSH command and coordinatorSshHost");
  }
  get(id: string): Device {
    const d = this.config.devices.find((d) => d.id === id);
    if (!d) throw Error("Unknown device: " + id);
    return d;
  }
  remote(id?: string) {
    return !!id && id !== this.config.localId;
  }
  public() {
    return {
      localDeviceId: this.config.localId,
      defaultDeviceId: this.config.defaultId,
      devices: this.config.devices.map(({ id, name, cwd }) => ({
        id,
        name,
        cwd,
      })),
    };
  }
}
export const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export const sshArgs = (host: string, command: string[]) => [
  "-T",
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=8",
  "-o",
  "ServerAliveInterval=10",
  "-o",
  "ServerAliveCountMax=3",
  host,
  command.map(quote).join(" "),
];
