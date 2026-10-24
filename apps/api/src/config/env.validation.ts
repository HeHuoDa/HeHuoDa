import Joi from "joi";
import { parseDnsOverrides } from "@hehuoda/sicau-connectors/notices";

export interface EnvironmentVariables {
  NODE_ENV: "development" | "test" | "production";
  PORT: number;
  HOST: string;
  SWAGGER_ENABLED: boolean;
  DATABASE_URL?: string;
  INGESTION_ENABLED: boolean;
  INGESTION_RAW_DAYS: number;
  INGESTION_DNS_OVERRIDES: string;
}

const environmentSchema = Joi.object({
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

  return value as EnvironmentVariables;
}
