type ApolloRuntime = {
  ApolloLink: any;
  Observable: any;
  getOperationName: (query: any) => string | null | undefined;
};

declare const require: (id: string) => any;

let cachedApolloRuntime: ApolloRuntime | null = null;

function getOperationName(query: any): string | null {
  const definitions = query?.definitions;

  if (!Array.isArray(definitions)) {
    return null;
  }

  for (const definition of definitions) {
    if (definition?.kind !== "OperationDefinition") {
      continue;
    }

    const operationName = definition.name?.value;

    if (typeof operationName === "string" && operationName.length > 0) {
      return operationName;
    }
  }

  return null;
}

export function getApolloRuntime(): ApolloRuntime {
  if (cachedApolloRuntime) {
    return cachedApolloRuntime;
  }

  try {
    const core = require("@apollo/client/core");

    cachedApolloRuntime = {
      ApolloLink: core.ApolloLink,
      Observable: core.Observable,
      getOperationName,
    };

    return cachedApolloRuntime;
  } catch {
    // Fall through and throw a unified error when the Apollo runtime is not resolvable.
  }

  throw new Error(
    "apollo-lazy-cache-persist: Unable to resolve Apollo runtime. Install @apollo/client v3 or v4.",
  );
}
