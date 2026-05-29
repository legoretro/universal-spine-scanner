const fs = require("fs");
const path = require("path");

function readEnvFile(rootDir) {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) {
    return {};
  }
  return fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .reduce((env, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return env;
      const index = trimmed.indexOf("=");
      if (index === -1) return env;
      env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim().replace(/^"|"$/g, "");
      return env;
    }, {});
}

function value(fileEnv, key, fallback) {
  return process.env[key] || fileEnv[key] || fallback || "";
}

function getConfig(rootDir) {
  const fileEnv = readEnvFile(rootDir);
  const config = {
    port: Number(value(fileEnv, "PORT", "4174")),
    supabaseUrl: value(fileEnv, "SUPABASE_URL"),
    supabaseServiceRoleKey: value(fileEnv, "SUPABASE_SERVICE_ROLE_KEY"),
    supabaseScansTable: value(fileEnv, "SUPABASE_SCANS_TABLE", "spine_scans"),
    ebayClientId: value(fileEnv, "EBAY_CLIENT_ID"),
    ebayClientSecret: value(fileEnv, "EBAY_CLIENT_SECRET"),
    ebayMarketplaceId: value(fileEnv, "EBAY_MARKETPLACE_ID", "EBAY_US"),
    ebayCurrency: value(fileEnv, "EBAY_CURRENCY", "USD"),
    ebayApiBaseUrl: "https://api.ebay.com"
  };

  config.supabaseConfigured = Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
  config.ebayConfigured = Boolean(config.ebayClientId && config.ebayClientSecret);

  config.publicConfig = function publicConfig() {
    return {
      supabaseConfigured: config.supabaseConfigured,
      ebayConfigured: config.ebayConfigured,
      marketplaceId: config.ebayMarketplaceId,
      currency: config.ebayCurrency
    };
  };

  return config;
}

module.exports = { getConfig };
