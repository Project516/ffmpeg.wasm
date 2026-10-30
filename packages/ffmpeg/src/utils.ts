/**
 * Generate an unique message ID.
 */
export const getMessageID = (() => {
  let messageID = 0;
  return () => messageID++;
})();

/**
 * Whether this runtime has JSPI, which the JSPI core needs.
 */
export const supportsJSPI = (): boolean =>
  "Suspending" in WebAssembly && "promising" in WebAssembly;
