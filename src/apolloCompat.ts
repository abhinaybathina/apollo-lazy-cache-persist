type ApolloRuntime = {
  ApolloLink: any;
  Observable: any;
  getOperationName: (query: any) => string | null | undefined;
};

let cachedApolloRuntime: ApolloRuntime | null = null;

function requireModule(id: string) {
  const dynamicRequire = (0, eval)("require");
  return dynamicRequire(id);
}

export function getApolloRuntime(): ApolloRuntime {
  if (cachedApolloRuntime) {
    return cachedApolloRuntime;
  }

  try {
    const core = requireModule("@apollo/client/core");
    const utilities = requireModule("@apollo/client/utilities");

    cachedApolloRuntime = {
      ApolloLink: core.ApolloLink,
      Observable: core.Observable,
      getOperationName: utilities.getOperationName,
    };

    return cachedApolloRuntime;
  } catch {}

  try {
    const link = requireModule("apollo-link");
    const utilities = requireModule("apollo-utilities");

    cachedApolloRuntime = {
      ApolloLink: link.ApolloLink,
      Observable: link.Observable,
      getOperationName: utilities.getOperationName,
    };

    return cachedApolloRuntime;
  } catch {}

  throw new Error(
    "apollo-lazy-cache-persist: Unable to resolve Apollo runtime. Install either @apollo/client (v3/v4) or apollo-link + apollo-utilities (v2).",
  );
}
