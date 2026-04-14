export interface ChannelConfig {
  enabled: boolean;
  [key: string]: unknown;
}

export interface GatewayConfig {
  port: number;
  internalPort?: number; // HTTPS port for internal mTLS API (default: 3002)
  host: string;
  plugins: {
    paths: string[];
  };
  channels: Record<string, ChannelConfig>;
}

const DEFAULT_CONFIG: GatewayConfig = {
  port: 3001,
  host: "0.0.0.0",
  plugins: {
    paths: ["./node_modules"],
  },
  channels: {},
};

export function loadGatewayConfig(): GatewayConfig {
  const config = { ...DEFAULT_CONFIG };
  if (process.env.SICLAW_GATEWAY_PORT) {
    config.port = parseInt(process.env.SICLAW_GATEWAY_PORT, 10);
  }
  return config;
}
