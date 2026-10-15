/**
 * Primitive, reusable Zod building blocks shared by every other contract file.
 *
 * Keep this file dependency-free (zod only) so it can be imported from anywhere
 * without creating import cycles.
 */
import { z } from 'zod';

/** RFC 4122 UUID string (Postgres `uuid`). */
export const UuidSchema = z.uuid();
export type Uuid = z.infer<typeof UuidSchema>;

/** ISO-8601 timestamp with offset (Postgres `timestamptz` serialised as string). */
export const TimestamptzSchema = z.iso.datetime({ offset: true });
export type Timestamptz = z.infer<typeof TimestamptzSchema>;

/** Calendar date `YYYY-MM-DD` (Postgres `date`). */
export const IsoDateSchema = z.iso.date();
export type IsoDate = z.infer<typeof IsoDateSchema>;

/**
 * BCP-47 language tag such as `fr-CA`, `zh-Hant-HK`, `es-419`, `ary`.
 * Intentionally permissive on subtag order; catalog validation enforces known values.
 */
export const Bcp47Schema = z
  .string()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Expected a BCP-47 language tag');
export type Bcp47 = z.infer<typeof Bcp47Schema>;

/** ISO-639-1/3 bare language code (`en`, `fr`, `ary`). */
export const IsoLanguageCodeSchema = z.string().regex(/^[a-z]{2,3}$/);

/** Lower-case kebab slug used for stable public identifiers (`arabic-moroccan`). */
export const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Expected a kebab-case slug');
export type Slug = z.infer<typeof SlugSchema>;

/** `snake_case` key used for skills, intents and i18n message keys (`greet_politely`). */
export const KeySchema = z.string().regex(/^[a-z0-9]+(?:[._][a-z0-9]+)*$/, 'Expected a snake_case/dotted key');
export type Key = z.infer<typeof KeySchema>;

/** Hex-encoded SHA-256 digest. */
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase hex SHA-256');
export type Sha256 = z.infer<typeof Sha256Schema>;

/** Semantic version string `MAJOR.MINOR.PATCH` (optionally with a pre-release tag). */
export const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

export const UrlSchema = z.url();
export const EmailSchema = z.email();

export const NonNegativeIntSchema = z.number().int().min(0);
export const PositiveIntSchema = z.number().int().min(1);
/** Milliseconds, non-negative integer. */
export const MillisSchema = NonNegativeIntSchema;
/** Bytes, non-negative integer. */
export const BytesSchema = NonNegativeIntSchema;
/** A probability / confidence in the closed interval [0, 1]. */
export const UnitIntervalSchema = z.number().min(0).max(1);
/** Percentage in [0, 100]. */
export const PercentSchema = z.number().min(0).max(100);

/** Arbitrary JSON (Postgres `jsonb`). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
);
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
export type JsonObject = z.infer<typeof JsonObjectSchema>;

/**
 * Map of locale/language code → text, used for inline localized fields
 * (`title_translations`, `description_translations`). Keys are BCP-47 or source-language codes.
 */
export const LocalizedTextSchema = z.record(Bcp47Schema, z.string());
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

/** Nullable helper that keeps JSDoc readable. */
export const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();

/** Validated hash reference `sha256:<hex>` for content-addressed objects. */
export const ContentHashRefSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/** Focal point for cropping artwork, expressed as fractions of width/height. */
export const FocalPointSchema = z.object({ x: UnitIntervalSchema, y: UnitIntervalSchema });
export type FocalPoint = z.infer<typeof FocalPointSchema>;

/** Pixel dimensions. */
export const DimensionsSchema = z.object({ width: PositiveIntSchema, height: PositiveIntSchema });
export type Dimensions = z.infer<typeof DimensionsSchema>;
