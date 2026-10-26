import Joi from "joi";
import { campusSettings } from "../campus/campus.config.js";
import { trustedProxy } from "./http-adapter.js";
import { parseDnsOverrides } from "@hehuoda/sicau-connectors/notices";
import {
  AUDIT_RETENTION_DAYS_DEFAULT,
  RATE_LIMIT_DEFAULTS,
} from "../auth/auth.constants.js";

export interface EnvironmentVariables {
  CAMPUS_VERIFICATION_ENABLED: boolean;
  CAMPUS_POLICY_VERSION: number;
  API_TRUSTED_PROXY_CIDRS: string;
  NODE_ENV: "development" | "test" | "production";
  PORT: number;
  HOST: string;
  SWAGGER_ENABLED: boolean;
  DATABASE_URL?: string;
  INGESTION_ENABLED: boolean;
  INGESTION_RAW_DAYS: number;
  INGESTION_DNS_OVERRIDES: string;
  WECHAT_LOGIN_ENABLED: boolean;
  SENSITIVE_BUSINESS_ENABLED: boolean;
  WECHAT_APP_ID: string;
  WECHAT_APP_SECRET: string;
  WECHAT_LOGIN_ADAPTER: "real" | "stub";
  AUTH_RATE_LOGIN_PER_SOURCE: number;
  AUTH_RATE_LOGIN_PER_IDENTITY: number;
  AUTH_RATE_LOGIN_GLOBAL: number;
  AUTH_RATE_REFRESH_PER_SUBJECT: number;
  AUTH_RATE_REFRESH_GLOBAL: number;
  AUTH_AUDIT_RETENTION_DAYS: number;
}

const environmentSchema = Joi.object({
  API_TRUSTED_PROXY_CIDRS: Joi.string()
    .allow("")
    .default("")
    .custom((value, helpers) => {
      try {
        trustedProxy(value);
        return value;
      } catch {
        return helpers.error("any.invalid");
      }
    }),
  CAMPUS_VERIFICATION_ENABLED: Joi.boolean().default(false),
  CAMPUS_POLICY_VERSION: Joi.number().integer().min(1).default(2),
  CAMPUS_RATE_SUBMIT_USER: Joi.number().integer().min(1).default(5),
  CAMPUS_RATE_SUBMIT_SOURCE: Joi.number().integer().min(1).default(100),
  CAMPUS_RATE_SUBMIT_GLOBAL: Joi.number().integer().min(1).default(500),
  CAMPUS_RATE_CHALLENGE_USER: Joi.number().integer().min(1).default(5),
  CAMPUS_RATE_CHALLENGE_SOURCE: Joi.number().integer().min(1).default(100),
  CAMPUS_RATE_CHALLENGE_GLOBAL: Joi.number().integer().min(1).default(500),
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ["postgres", "postgresql"] })
    .when("NODE_ENV", { is: "production", then: Joi.required() }),
  PORT: Joi.number().integer().min(1).max(65535).default(3001),
  HOST: Joi.string()
    .ip({ version: ["ipv4", "ipv6"] })
    .default("127.0.0.1"),
  SWAGGER_ENABLED: Joi.boolean().when("NODE_ENV", {
    is: "production",
    then: Joi.boolean().default(false),
    otherwise: Joi.boolean().default(true),
  }),
  INGESTION_ENABLED: Joi.boolean().default(true),
  INGESTION_RAW_DAYS: Joi.number().integer().min(1).max(365).default(30),
  INGESTION_DNS_OVERRIDES: Joi.string()
    .allow("")
    .default("")
    .custom((value, helpers) => {
      try {
        parseDnsOverrides(value);
        return value;
      } catch {
        return helpers.error("any.invalid");
      }
    }),
  // 微信登录默认关闭；开启后才要求服务器配置有效 AppID/AppSecret。
  WECHAT_LOGIN_ENABLED: Joi.boolean().default(false),
  SENSITIVE_BUSINESS_ENABLED: Joi.boolean().default(false),
  WECHAT_APP_ID: Joi.string()
    .allow("")
    .default("")
    .when("WECHAT_LOGIN_ENABLED", {
      is: true,
      then: Joi.string().min(6).required(),
    }),
  WECHAT_APP_SECRET: Joi.string()
    .allow("")
    .default("")
    .when("WECHAT_LOGIN_ENABLED", {
      is: true,
      then: Joi.string().min(16).required(),
    }),
  // stub 是离线测试替身，生产环境禁止启用。
  WECHAT_LOGIN_ADAPTER: Joi.alternatives().conditional("NODE_ENV", {
    is: "production",
    then: Joi.string().valid("real").default("real"),
    otherwise: Joi.string().valid("real", "stub").default("real"),
  }),
  AUTH_RATE_LOGIN_PER_SOURCE: Joi.number()
    .integer()
    .min(1)
    .default(RATE_LIMIT_DEFAULTS.loginPerSource),
  AUTH_RATE_LOGIN_PER_IDENTITY: Joi.number()
    .integer()
    .min(1)
    .default(RATE_LIMIT_DEFAULTS.loginPerIdentity),
  AUTH_RATE_LOGIN_GLOBAL: Joi.number()
    .integer()
    .min(1)
    .default(RATE_LIMIT_DEFAULTS.loginGlobal),
  AUTH_RATE_REFRESH_PER_SUBJECT: Joi.number()
    .integer()
    .min(1)
    .default(RATE_LIMIT_DEFAULTS.refreshPerSubject),
  AUTH_RATE_REFRESH_GLOBAL: Joi.number()
    .integer()
    .min(1)
    .default(RATE_LIMIT_DEFAULTS.refreshGlobal),
  AUTH_AUDIT_RETENTION_DAYS: Joi.number()
    .integer()
    .min(1)
    .max(3650)
    .default(AUDIT_RETENTION_DAYS_DEFAULT),
}).unknown(true);

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const { error, value } = environmentSchema.validate(config, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    throw error;
  }

  campusSettings(value);
  return value as EnvironmentVariables;
}
