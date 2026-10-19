// Platform-neutral query values; no dependency on Vue Router or uni-app.
export type QueryValue = string | null | (string | null)[] | undefined;
export type Query = Record<string, QueryValue>;
