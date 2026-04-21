/**
 * Global stdout redirection for MCP JSON-RPC compatibility.
 * This file MUST be imported before any other module that might perform logging
 * or import the @myx-trade/sdk.
 */
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encoding, callback) => {
    const output = chunk.toString();
    // JSON-RPC messages always start with { "jsonrpc": "2.0"
    if (output.trim().startsWith('{') && output.includes('"jsonrpc"')) {
        return originalStdoutWrite(chunk, encoding, callback);
    }
    // Everything else goes to stderr
    return process.stderr.write(chunk, encoding, callback);
};
// Also explicitly redirect console.log to console.error
console.log = console.error;
console.info = console.error;
console.debug = console.error;
console.warn = console.error;
export {};
