export type Mount = {
  id: string;
  name: string;
  path: string;
  kind: string;
  enabled: boolean;
};
export type Config = {
  host: string;
  port: number;
  accessToken: string;
  theme: string;
  mounts: Mount[];
  publicUrl: string;
  publicPort: number | null;
};
