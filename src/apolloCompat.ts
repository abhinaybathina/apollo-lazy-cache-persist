type ApolloRuntime = {
  ApolloLink: any;
  Observable: any;
  getOperationName: (query: any) => string | null | undefined;
};

declare const require: (id: string) => any;

let cachedApolloRuntime: ApolloRuntime | null = null;

export function getApolloRuntime(): ApolloRuntime {
  if (cachedApolloRuntime) {
    return cachedApolloRuntime;
  }

  try {
    const core = require("@apollo/client/core");
    const utilities = require("@apollo/client/utilities");
    const internalUtilities = (() => {
      try {
        return require("@apollo/client/utilities/internal");
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
    const link = require("apollo-link");
    const utilities = require("apollo-utilities");

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
    "apollo-lazy-cache-persist: Unable to resolve Apollo runtime. Install @apollo/client v3 or v4, or for Apollo Client v2 install apollo-link and apollo-utilities.",
  );
}
