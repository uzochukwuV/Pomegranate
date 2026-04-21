export const logger = {
    info: (message, meta) => {
        console.error(`[INFO] ${new Date().toISOString()} - ${message}`, meta ? meta : "");
    },
    warn: (message, meta) => {
        console.error(`[WARN] ${new Date().toISOString()} - ${message}`, meta ? meta : "");
    },
    error: (message, err) => {
        console.error(`[ERROR] ${new Date().toISOString()} - ${message}`);
        if (err) {
            console.error(err.stack || err);
        }
    },
    toolExecution: (toolName, args) => {
        console.error(`[TOOL_EXECUTION] ${new Date().toISOString()} - Target: ${toolName}`);
        console.error(JSON.stringify(args, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    }
};
