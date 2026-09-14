// Each loader owns one request. Replacing it aborts network work and prevents
// late responses from committing after a profile/period change or unmount.
export function createLatestRequest() {
  let controller;
  return {
    async run(task, ...args) {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        return await task(current.signal, ...args);
      } finally {
        if (controller === current) controller = undefined;
      }
    },
    cancel() {
      controller?.abort();
      controller = undefined;
    },
  };
}
