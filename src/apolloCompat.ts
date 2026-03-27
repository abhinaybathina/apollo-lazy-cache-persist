type ApolloRuntime = {
  ApolloLink: any;
  Observable: any;
  getOperationName: (query: any) => string | null | undefined;
};

declare const require: any;

let cachedApolloRuntime: ApolloRuntime | null = null;

function requireModule(id: string) {
  return require(id);
}

export function getApolloRuntime(): ApolloRuntime {
  if (cachedApolloRuntime) {
    return cachedApolloRuntime;
  }

  try {
    const core = requireModule("@apollo/client/core");
    const utilities = requireModule("@apollo/client/utilities");
    const internalUtilities = (() => {
      try {
        return requireModule("@apollo/client/utilities/internal");
      } catch {
        return null;
      }
    })();
    const getOperationName =
      utilities.getOperationName ?? internalUtilities?.getOperationName;

    if (!getOperationName) {
      throw new Error("getOperationName unavailable");
    }

    cachedApolloRuntime = {
      ApolloLink: core.ApolloLink,
      Observable: core.Observable,
      getOperationName,
    };

    return cachedApolloRuntime;
  } catch {
    // Fallback to Apollo v2 packages when @apollo/client runtime modules are unavailable.
  }

  try {
    const link = requireModule("apollo-link");
    const utilities = requireModule("apollo-utilities");

    cachedApolloRuntime = {
      ApolloLink: link.ApolloLink,
      Observable: link.Observable,
      getOperationName: utilities.getOperationName,
    };

    return cachedApolloRuntime;
  } catch {
    // Fall through and throw a unified error when neither Apollo runtime is resolvable.
  }

  throw new Error(
    "apollo-lazy-cache-persist: Unable to resolve Apollo runtime. Install either @apollo/client (v3/v4) or apollo-link + apollo-utilities (v2).",
  );
}
