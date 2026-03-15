const PAGINATION_KEYS = [
  "cursor",
  "offset",
  "after",
  "before",
  "first",
  "last",
];

function sortKeys(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }

  if (obj !== null && typeof obj === "object") {
    return Object.keys(obj)
      .sort()
      .reduce((acc: any, key) => {
        acc[key] = sortKeys(obj[key]);
        return acc;
      }, {});
  }

  return obj;
}

export function generateCacheKey(
  operationName: string,
  variables: Record<string, any> | undefined,
  hash?: (value: string) => string,
) {
  if (!variables) return operationName;

  const sorted = sortKeys(variables);
  const json = JSON.stringify(sorted);

  const variableKey = hash ? hash(json) : json;

  return `${operationName}:${variableKey}`;
}

export function isPaginatedRequest(variables?: Record<string, any>) {
  if (!variables) return false;

  const json = JSON.stringify(variables);

  return PAGINATION_KEYS.some((key) => json.includes(`"${key}":`));
}

export function isQueryOperation(operation: any) {
  const definition = operation.query.definitions.find(
    (d: any) => d.kind === "OperationDefinition",
  );

  return definition?.operation === "query";
}
