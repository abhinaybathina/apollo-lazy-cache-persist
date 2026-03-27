import { getApolloRuntime } from "./apolloCompat";
import {
  generateCacheKey,
  isPaginatedRequest,
  isQueryOperation,
} from "./utils";
import { LazyCacheLinkConfig, LazyCacheStore } from "./types";

export function createLazyCacheLink({
  cache,
  store,
  hash,
}: LazyCacheLinkConfig) {
  const { ApolloLink, Observable, getOperationName } = getApolloRuntime();

  return new ApolloLink((operation, forward) => {
    if (!isQueryOperation(operation)) {
      return forward(operation);
    }

    const operationName = getOperationName(operation.query);

    if (!operationName) {
      return forward(operation);
    }

    const variables = operation.variables;

    if (isPaginatedRequest(variables)) {
      return forward(operation);
    }

    const key = generateCacheKey(operationName, variables, hash);

    let networkResolved = false;

    store.get(key).then((data) => {
      if (!data || networkResolved) return;

      try {
        const existing = cache.readQuery({
          query: operation.query,
          variables,
        });

        if (!existing) {
          cache.writeQuery({
            query: operation.query,
            variables,
            data,
          });
        }
      } catch {
        try {
          cache.writeQuery({
            query: operation.query,
            variables,
            data,
          });
        } catch {}
      }
    });

    return new Observable((observer) => {
      const sub = forward(operation).subscribe({
        next: (result) => {
          networkResolved = true;

          if (result?.data) {
            store.set(key, result.data);
          }

          observer.next(result);
        },
        error: (err) => observer.error(err),
        complete: () => observer.complete(),
      });

      return () => sub.unsubscribe();
    });
  });
}
